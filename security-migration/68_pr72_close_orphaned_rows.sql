-- ============================================================================
-- Migration 68 (PR #72 hotfix) — إغلاق الصفوف اليتيمة التي عُلّمت approved زوراً بواسطة M66
-- ----------------------------------------------------------------------------
-- تشخيص Kayed للصفوف الثلاثة (80/84/260): status='not_uploaded' · pdf_file_path=NULL ·
--   evaluation_id=NULL · emp_week_evals=0 (لا تقييم لنفس الموظف/الأسبوع) · audit_events=3.
--   أي: أسابيع لم يرفع فيها الموظف شيئاً، بلا تقييم — أُدرجت في كنس M66 (workflow_state IS NULL)
--   فصارت 'approved' زيفاً. لا يمكن استعادتها لـpending_quality (لا PDF لتقيّمه الجودة).
--
-- القرار: 'closed' (نهائية، خارج التدفّق) + سطر audit يشرح السبب.
-- الأثر: workflow_state='closed' + تصفير approved_at/objection_deadline (قيم M66). لا يمسّ status.
--
-- الاستهداف: المعرّفات الثلاثة صراحةً + حارس توقيع (approved + بلا تقييم + بلا PDF) لمنع
--   إغلاق أي صفّ تغيّر بعد التشخيص. self-verify يؤكّد ROW_COUNT=3 وإلا يفشل (atomic).
-- الفاعل في الـaudit = أوّل أدمن نشط (لتفادي actor_id فارغ)؛ السبب الحقيقي في notes/metadata.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_ids   bigint[] := ARRAY[80, 84, 260];
  v_actor bigint;
  v_closed int;
  r record;
BEGIN
  -- فاعل غير فارغ للـaudit
  SELECT id INTO v_actor FROM public.users
   WHERE role = 'admin' AND coalesce(is_active, true) ORDER BY id LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Migration 68 — لا يوجد أدمن نشط لتسجيل الـaudit';
  END IF;

  -- سطر audit لكل صفّ (from='approved' الزائف → 'closed') قبل الإغلاق
  FOR r IN
    SELECT id, evaluation_id, workflow_state
      FROM public.creative_gene_weekly_status
     WHERE id = ANY(v_ids)
       AND workflow_state = 'approved' AND evaluation_id IS NULL AND pdf_file_path IS NULL
  LOOP
    PERFORM public.wf_audit(
      r.id, r.evaluation_id, r.workflow_state, 'closed', 'system_close',
      v_actor, 'admin',
      'إغلاق صفّ يتيم بلا رفعة (status=not_uploaded) — عُلّم approved خطأً بواسطة M66. PR#72.',
      jsonb_build_object('reason', 'orphaned_by_m66_no_upload', 'pr', 72)
    );
  END LOOP;

  -- الإغلاق
  UPDATE public.creative_gene_weekly_status
     SET workflow_state    = 'closed',
         approved_at        = NULL,
         objection_deadline = NULL,
         updated_at         = now()
   WHERE id = ANY(v_ids)
     AND workflow_state = 'approved' AND evaluation_id IS NULL AND pdf_file_path IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RAISE NOTICE 'PR#72/M68: أُغلق % صفّاً يتيماً (المستهدف 3): %', v_closed, v_ids;
  IF v_closed <> 3 THEN
    RAISE EXCEPTION 'Migration 68 FAILED — أُغلق % صفّاً بدل 3 (تأكّد أن 80/84/260 لا تزال approved+بلا تقييم+بلا PDF)', v_closed;
  END IF;
  RAISE NOTICE 'Migration 68 OK — 3 صفوف يتيمة أُغلقت مع سطر audit (orphaned_by_m66_no_upload)';
END $$;

COMMIT;

-- Rollback: UPDATE public.creative_gene_weekly_status SET workflow_state='approved'
--   WHERE id IN (80,84,260);  (لا يُوصى — يعيد التعليم الزائف)
