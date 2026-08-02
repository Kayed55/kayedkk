-- =========================================================================
-- 51_users_public_expose_template_id.sql  (إصلاح — كشف template_id في users_public)
--
-- العلّة: pullAll يقرأ view public.users_public (لا جدول users). الـview (ملف 26)
-- يُعدّد أعمدته صراحةً ولا يشمل template_id (أُضيف للجدول في ملف 46 لاحقاً) →
-- DB.data.users[*].template_id = undefined → يكسر: فلتر النموذج (#51/F1) + العرض
-- المشتقّ (#47) + pre-select في نماذج ef/usr (#46/#50). الكود العميل صحيح.
--
-- الإصلاح: إعادة بناء الـview بإلحاق template_id في نهاية قائمة الأعمدة
-- (CREATE OR REPLACE VIEW يسمح بالإلحاق في النهاية دون تغيير الموجود).
-- المتن مطابق لملف 26 + template_id. المرجع: #38 / F1. التاريخ: 2026-08-02.
-- ⚠️ إن اختلفت أعمدة الـview الحيّة عن ملف 26 → CREATE OR REPLACE يُخطئ (آمن، لا إفساد)؛
--    عندها الصق pg_get_viewdef وسأطابق.
-- =========================================================================
BEGIN;

CREATE OR REPLACE VIEW public.users_public AS
 SELECT id, username, email, full_name, phone, role, department, "position",
        employee_number, supervisor_name, supervisor_id, is_active, must_change_password,
        password_changed_at, password_reset_at, created_at, updated_at, department_id,
        hire_date, last_login_at, notes, job_role, job_title,
        coalesce(email_notifications_enabled, true) AS email_notifications_enabled,
        template_id
   FROM public.users
  WHERE deleted_at IS NULL;

-- حارس تحقّق قبل COMMIT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='users_public' AND column_name='template_id') THEN
    RAISE EXCEPTION 'users_public.template_id غير موجود بعد إعادة البناء';
  END IF;
  RAISE NOTICE '✅ SQL 51: users_public يكشف template_id الآن';
END $$;

COMMIT;
