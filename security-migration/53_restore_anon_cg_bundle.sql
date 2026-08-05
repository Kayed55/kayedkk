-- ============================================================================
-- Migration 53 — RESTORE anon EXECUTE on get_cg_week_bundle (إلغاء Hotfix 52 الخاطئة)
--
-- الفحص التجريبي أكّد المعمارية:
--   get_creative_gene_status / get_dashboard_stats / list_departments → anon_exec=true (تعمل)
--   get_cg_week_bundle → anon_exec=false (مكسور بسبب Hotfix 52)
--
-- النظام: anonKey + verify_session المخصّص (لا GoTrue). كل استدعاءات PostgREST = دور anon.
--   الأمان داخل الدالة (verify_session + role IN admin/quality_officer). REVOKE anon = كسر التطبيق.
--
-- تطبيق: شغّل الملف كاملاً في Supabase SQL Editor (يتحقّق ذاتياً داخل المعاملة).
-- ============================================================================

BEGIN;

GRANT EXECUTE ON FUNCTION public.get_cg_week_bundle(text, date) TO anon;

-- تحقّق ذاتي داخل المعاملة (يفشل ويتراجع لو لم يُطبَّق المنح)
DO $$
DECLARE v_anon boolean;
BEGIN
  SELECT has_function_privilege('anon', oid, 'EXECUTE')
  INTO v_anon
  FROM pg_proc WHERE proname = 'get_cg_week_bundle';

  IF NOT v_anon THEN
    RAISE EXCEPTION 'FAILED: get_cg_week_bundle still not anon-executable';
  END IF;
  RAISE NOTICE 'SUCCESS: get_cg_week_bundle anon_exec=true';
END $$;

COMMIT;

-- تحقّق نهائي (خارج المعاملة):
-- SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
-- FROM pg_proc WHERE proname = 'get_cg_week_bundle';
-- -- متوقّع: anon_exec=true
--
-- قبولي (العميل): cg-week → Network → get_cg_week_bundle استدعاء واحد (لا get_creative_gene_status + objections + actions).
-- ============================================================================
