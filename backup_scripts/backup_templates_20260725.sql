-- =========================================================================
-- نسخة احتياطية كاملة لجدول evaluation_templates — قبل ترحيل م24-ب
-- =========================================================================
-- تُنفَّذ **أولاً** في Supabase SQL Editor، قبل ملف 36، وبالإضافة إلى
-- Supabase Auto Backup. تنسخ كل الصفوف كما هي (لقطة استرجاع فورية).
-- التاريخ: 2026-07-25
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.evaluation_templates_backup_20260725 AS
  SELECT * FROM public.evaluation_templates;

-- تحقّق (يجب أن يتطابق العدد مع الأصل):
--   SELECT
--     (SELECT count(*) FROM public.evaluation_templates)                    AS original,
--     (SELECT count(*) FROM public.evaluation_templates_backup_20260725)    AS backup;
--   -- متوقّع: original = backup

-- الاسترجاع الطارئ (عند الحاجة فقط — لا يُنفَّذ الآن):
--   BEGIN;
--   -- استعادة الأعمدة الأصلية للصفوف (بعد إزالة قيود م24-ب لو لزم)
--   -- TRUNCATE public.evaluation_templates;
--   -- INSERT INTO public.evaluation_templates SELECT * FROM public.evaluation_templates_backup_20260725;
--   COMMIT;
-- =========================================================================
