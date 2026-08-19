-- ============================================================================
-- Migration 69 (PR #73) — إنشاء قسم «عزوة» (مطابق لمحزم) + نسخ نموذجه الافتراضي
-- ----------------------------------------------------------------------------
-- القرار: عزوة = قسم section_based مطابق لمحزم بالكامل (نفس البنية/الصلاحيات/التقارير)،
--   الفرق الوحيد: الاسم «عزوة» وموظفوها. pass_score=80 مثل محزم. تبدأ بلا موظفين.
-- الآلية: صفّ قسم جديد فقط (بلا عمود جديد) — العزل قائم أصلاً عبر users.department_id.
-- النموذج: نسخ template_jsonb من قالب محزم الافتراضي (id=1) كنقطة انطلاق مستقلة.
--
-- حواجز الأمان:
--   • transactional (BEGIN/COMMIT) + DO self-verify + RAISE EXCEPTION عند أي خلل.
--   • إثبات صفر مساس: عدّ users/evaluations/objections قبل=بعد + قسم محزم (id=2) بلا تغيير.
--   • INSERT فقط (لا UPDATE/DELETE على أي بيانات قائمة) — بيانات محزم لا تُلمَس إطلاقاً.
--   • حارس تكرار: يفشل إن كانت عزوة موجودة مسبقاً.
-- ملاحظة: الفرونت يحلّ عزوة بالـcode='azwa' (azwaDeptId) — لا حاجة لمعرّف صلب.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_azwa_id  bigint;
  v_tpl_id   bigint;
  v_u0 int; v_e0 int; v_o0 int;
  v_u1 int; v_e1 int; v_o1 int;
  v_mahzam_ok boolean;
BEGIN
  -- خط الأساس (إثبات صفر مساس)
  SELECT count(*) INTO v_u0 FROM public.users;
  SELECT count(*) INTO v_e0 FROM public.evaluations;
  SELECT count(*) INTO v_o0 FROM public.objections;

  -- حارس تكرار
  IF EXISTS (SELECT 1 FROM public.departments WHERE code='azwa') THEN
    RAISE EXCEPTION 'عزوة (code=azwa) موجودة مسبقاً — أوقف';
  END IF;

  -- 1) إدراج قسم عزوة (مطابق لمحزم: pass_score=80، ظاهر في الواجهة)
  INSERT INTO public.departments
    (name, code, description, manager_user_id, is_active, is_visible_in_ui, pass_score, created_at, updated_at)
  VALUES ('عزوة', 'azwa', NULL, NULL, true, true, 80, now(), now())
  RETURNING id INTO v_azwa_id;

  -- 2) نسخ نموذج محزم الافتراضي (id=1) لعزوة — نفس template_jsonb والنوع والبنية
  INSERT INTO public.evaluation_templates
    (department_id, template_type, template_jsonb, version, is_active,
     created_at, updated_at, updated_by, job_role, name, status)
  SELECT v_azwa_id, template_type, template_jsonb, version, true,
         now(), now(), updated_by,
         'azwa_default',                    -- job_role خاص بعزوة (تفادي أي تعارض تفرّد)
         'النموذج الافتراضي — عزوة', status
  FROM public.evaluation_templates WHERE id = 1
  RETURNING id INTO v_tpl_id;

  IF v_tpl_id IS NULL THEN
    RAISE EXCEPTION 'فشل نسخ النموذج — قالب محزم id=1 غير موجود';
  END IF;

  -- تحقّق بنية نموذج عزوة (نشط + section_based + يحوي مفتاح sections)
  IF NOT EXISTS (
    SELECT 1 FROM public.evaluation_templates
    WHERE id=v_tpl_id AND department_id=v_azwa_id AND is_active
      AND template_type='section_based' AND template_jsonb ? 'sections'
  ) THEN
    RAISE EXCEPTION 'نموذج عزوة غير سليم بعد النسخ';
  END IF;

  -- 3) إثبات صفر مساس بالموظفين/التقييمات/الاعتراضات
  SELECT count(*) INTO v_u1 FROM public.users;
  SELECT count(*) INTO v_e1 FROM public.evaluations;
  SELECT count(*) INTO v_o1 FROM public.objections;
  IF v_u1<>v_u0 OR v_e1<>v_e0 OR v_o1<>v_o0 THEN
    RAISE EXCEPTION 'تغيّرت بيانات غير مستهدفة! users %→% · evaluations %→% · objections %→%',
      v_u0,v_u1, v_e0,v_e1, v_o0,v_o1;
  END IF;

  -- قسم محزم (id=2) بلا أي تغيير
  SELECT (code='mahzam' AND pass_score=80) INTO v_mahzam_ok FROM public.departments WHERE id=2;
  IF NOT coalesce(v_mahzam_ok,false) THEN
    RAISE EXCEPTION 'قسم محزم (id=2) تغيّر — أوقف';
  END IF;

  RAISE NOTICE 'Migration 69 OK — عزوة id=% · نموذجها id=%', v_azwa_id, v_tpl_id;
  RAISE NOTICE '  صفر مساس: users=% · evaluations=% · objections=% (= خط الأساس)', v_u1, v_e1, v_o1;
  RAISE NOTICE '  ★ عزوة تبدأ بلا موظفين (تُضاف من إدارة الموظفين). الفرونت يحلّها بالـcode=azwa.';
END $$;

COMMIT;

-- Rollback (إن لزم قبل ربط أي موظف/تقييم بعزوة):
--   DELETE FROM public.evaluation_templates WHERE department_id=(SELECT id FROM public.departments WHERE code='azwa');
--   DELETE FROM public.departments WHERE code='azwa';
