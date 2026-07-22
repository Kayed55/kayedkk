-- ============================================================
-- ملف 32 (تنظيف): إسقاط الـ overloads الميتة لدوال كتابة التقييم
-- ============================================================
-- الخلفية: أثناء م19 اكتُشف وجود نسختين لكل من create_evaluation و
-- admin_update_evaluation: النسخة الحيّة (تبدأ بـ p_session_token text) التي
-- يستدعيها التطبيق فعلاً، ونسخة قديمة «ميتة» (تبدأ بـ bigint، بلا رمز جلسة)
-- لا يستدعيها أي مسار في العميل. هذه النسخ الميتة:
--   • سطح تجاوز مصادقة محتمل (هوية مباشرة بلا verify_session).
--   • خطر التباس overload مستقبلي في حلّ الاستدعاءات.
--
-- فحص الأمان (pg_depend) — أكّده كايد يدوياً في Supabase (2026-07-22):
--   0 تبعيات على أيٍّ من التوقيعين الميتين → الإسقاط آمن.
--   الاستعلام المُستخدَم:
--     SELECT d.classid::regclass, d.objid::regprocedure, d.deptype
--     FROM pg_depend d
--     WHERE d.refobjid IN (
--       (SELECT oid FROM pg_proc WHERE proname='admin_update_evaluation' AND pronargs=5  AND pronamespace='public'::regnamespace),
--       (SELECT oid FROM pg_proc WHERE proname='create_evaluation'       AND pronargs=10 AND pronamespace='public'::regnamespace));
--   النتيجة: (لا صفوف).
-- ============================================================

BEGIN;

-- admin_update_evaluation(p_evaluation_id bigint, p_editor_id bigint, p_items jsonb, p_tasks jsonb, p_role_kpis_values jsonb)
DROP FUNCTION IF EXISTS public.admin_update_evaluation(bigint, bigint, jsonb, jsonb, jsonb);

-- create_evaluation(p_employee_id bigint, p_evaluator_id bigint, p_items jsonb, p_template_snapshot jsonb,
--   p_template_version integer, p_template_type text, p_tasks jsonb, p_role_kpis_values jsonb, p_week_start date, p_week_end date)
DROP FUNCTION IF EXISTS public.create_evaluation(bigint, bigint, jsonb, jsonb, integer, text, jsonb, jsonb, date, date);

COMMIT;

-- ============================================================
-- تحقّق بعد التنفيذ: يجب أن يبقى overload واحد فقط لكل دالة (الحيّة).
--   SELECT p.oid::regprocedure, p.pronargs
--   FROM pg_proc p
--   WHERE p.pronamespace='public'::regnamespace
--     AND p.proname IN ('create_evaluation','admin_update_evaluation')
--   ORDER BY p.proname, p.pronargs;
--   المتوقّع: create_evaluation(…18…) فقط ، admin_update_evaluation(…12…) فقط.
-- ============================================================
