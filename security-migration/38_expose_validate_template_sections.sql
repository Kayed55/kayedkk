-- =========================================================================
-- 38_expose_validate_template_sections.sql  (م25)
-- كشف المُحقّق _validate_template_sections للعميل (كان داخلياً فقط في SQL 37).
-- الغرض: يستدعيه معالج CG كتحقق أوزان/بنية خادمي قبل الحفظ — بلا لمس دوال CG
--        (upsert_evaluation_template / create_cg_template) التي لا مصدر لها بالمستودع.
-- الأمان: دالة نقية (لا وصول لبيانات، لا آثار جانبية، لا جلسة) — كشفها آمن.
-- تغيير ذرّي بطبعه (سطر GRANT واحد) — لا حاجة لـ BEGIN/COMMIT.
-- التاريخ: 2026-07-26
-- =========================================================================

GRANT EXECUTE ON FUNCTION public._validate_template_sections(text, jsonb) TO anon, authenticated;

-- =========================================================================
-- تحقّق (اختياري):
--   SELECT proname, proacl FROM pg_proc
--   WHERE proname='_validate_template_sections' AND pronamespace='public'::regnamespace;
--   -- المتوقّع: proacl يتضمّن anon=X و authenticated=X
-- =========================================================================
