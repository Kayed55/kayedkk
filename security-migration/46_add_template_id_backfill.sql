-- =========================================================================
-- 46_add_template_id_backfill.sql  (Phase 1 — ربط الموظف بالنموذج مباشرة)
--
-- إضافة users.template_id (FK → evaluation_templates) + backfill من (department_id, job_role).
-- Phase 1 = DDL + Backfill فقط. لا مساس بـjob_role/RPCs/UI (مراحل لاحقة).
--
-- القرارات (محسومة): ق1 job_role يبقى derived · ق2 اسم النموذج مصدر العرض (job_title override) ·
--   ق3 backfill عبر (department_id, job_role). الأربعة القيادات (dept/job_role=NULL) يبقون بلا template_id.
-- المتوقّع: 56 مرتبط · 4 بلا ربط. كل شيء داخل transaction — يُجهَض تلقائياً عند أي فشل تحقّق.
-- المرجع: #38 (م24-و / RFC). التاريخ: 2026-08-02.
-- =========================================================================
BEGIN;

-- (1) العمود + FK
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS template_id bigint
    REFERENCES public.evaluation_templates(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- (2) Backfill: (department_id, job_role) → evaluation_templates.id (النشط)
UPDATE public.users u
SET template_id = t.id
FROM public.evaluation_templates t
WHERE t.department_id = u.department_id
  AND t.is_active
  AND (t.job_role = u.job_role OR (t.job_role IS NULL AND u.job_role IS NULL))
  AND u.is_active
  AND u.template_id IS NULL;

-- (3) حارس تحقّق قبل COMMIT — يُجهض الـtx (ROLLBACK ضمني) عند أي شرط false
DO $$
DECLARE
  v_backfill int; v_unmatched int; v_col boolean; v_fk boolean;
BEGIN
  SELECT count(*) INTO v_backfill  FROM public.users WHERE is_active AND template_id IS NOT NULL;
  SELECT count(*) INTO v_unmatched FROM public.users WHERE is_active AND template_id IS NULL;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='users' AND column_name='template_id') INTO v_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_schema='public' AND table_name='users'
                   AND constraint_type='FOREIGN KEY' AND constraint_name LIKE '%template_id%') INTO v_fk;

  IF v_backfill <> 56 THEN RAISE EXCEPTION 'backfill_count=% (المتوقّع 56) — إجهاض', v_backfill; END IF;
  IF v_unmatched <> 4  THEN RAISE EXCEPTION 'unmatched_count=% (المتوقّع 4) — إجهاض', v_unmatched; END IF;
  IF NOT v_col THEN RAISE EXCEPTION 'column template_id غير موجود — إجهاض'; END IF;
  IF NOT v_fk  THEN RAISE EXCEPTION 'FK template_id غير موجود — إجهاض'; END IF;
  RAISE NOTICE '✅ Phase 1 checks: backfill=% unmatched=% column=% fk=%', v_backfill, v_unmatched, v_col, v_fk;
END $$;

-- (3-عرض) نفس التحقّق كصفّ boolean مرئي (للأرشفة/اللصق)
SELECT
  (SELECT count(*) FROM public.users WHERE is_active AND template_id IS NOT NULL) = 56 AS backfill_count_ok,
  (SELECT count(*) FROM public.users WHERE is_active AND template_id IS NULL) = 4     AS unmatched_count_ok,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='users' AND column_name='template_id') AS column_exists,
  EXISTS (SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema='public' AND table_name='users'
            AND constraint_type='FOREIGN KEY' AND constraint_name LIKE '%template_id%')      AS fk_exists;

-- (4) فهرس الأداء
CREATE INDEX IF NOT EXISTS ix_users_template_id ON public.users(template_id);

COMMIT;
