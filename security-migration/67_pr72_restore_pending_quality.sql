-- ============================================================================
-- Migration 67 (PR #72 hotfix) — استعادة رفعات الموظفين التي عُلّمت approved زوراً بواسطة M66
-- ----------------------------------------------------------------------------
-- الخلفية: M66 رحّل WHERE workflow_state IN ('pending_supervisor','pending_quality') OR IS NULL → 'approved'.
--   لكن صفوف pending_quality = رفعات موظفين لم تُقيَّمها الجودة بعد (لها pdf_file_path، بلا evaluation_id).
--   بتعليمها approved اختفت من queue الجودة (cg-requests) وبدت «معتمدة» دون تقييم.
--
-- التوقيع القاطع (بلا hardcode للمعرّفات):
--   workflow_state='approved' AND evaluation_id IS NULL AND pdf_file_path IS NOT NULL
--   السبب أنه قاطع: create_evaluation يضبط approved *مع* evaluation_id دائماً، فـapproved بلا تقييم
--   ومعه PDF لا يمكن أن ينشأ إلا من تحديث M66 الخام. صفر false-positive.
--
-- الأثر: يعيد الحالة إلى 'pending_quality' + يصفّر approved_at/objection_deadline (قيم زرعها M66).
--   لا يمسّ عمود status (M66 لم يمسّه) ولا evaluation_id (NULL أصلاً).
-- الصفوف الثلاثة بلا PDF (84/80/260) خارج نطاق هذا الملف — تُعالَج في 68 بعد تشخيص wf_audit/evaluations.
-- ============================================================================

BEGIN;

DO $$
DECLARE v_ids bigint[]; v_restored int; v_left int;
BEGIN
  -- المعرّفات المستهدفة (للسجل قبل التحديث)
  SELECT array_agg(id ORDER BY id) INTO v_ids
  FROM public.creative_gene_weekly_status
  WHERE workflow_state = 'approved' AND evaluation_id IS NULL AND pdf_file_path IS NOT NULL;

  RAISE NOTICE 'PR#72: صفوف مستهدفة للاستعادة = % · المعرّفات = %',
    coalesce(array_length(v_ids, 1), 0), v_ids;

  -- الاستعادة
  UPDATE public.creative_gene_weekly_status
     SET workflow_state    = 'pending_quality',
         approved_at        = NULL,
         objection_deadline = NULL,
         updated_at         = now()
   WHERE workflow_state = 'approved' AND evaluation_id IS NULL AND pdf_file_path IS NOT NULL;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  -- تحقّق ذاتي: لم يتبقَّ أي صفّ بنفس التوقيع
  SELECT count(*) INTO v_left
  FROM public.creative_gene_weekly_status
  WHERE workflow_state = 'approved' AND evaluation_id IS NULL AND pdf_file_path IS NOT NULL;

  RAISE NOTICE 'PR#72: تمّت استعادة % صفّاً → pending_quality · المتبقّي بالتوقيع = %', v_restored, v_left;

  IF v_left <> 0 THEN
    RAISE EXCEPTION 'Migration 67 FAILED — بقي % صفّاً غير مُسترجَع', v_left;
  END IF;
  RAISE NOTICE 'Migration 67 OK — رفعات الموظفين أُعيدت إلى queue الجودة (pending_quality)';
END $$;

COMMIT;

-- Rollback (غير موصى — يعيد الخطأ): UPDATE ... SET workflow_state='approved', approved_at=now()
--   WHERE workflow_state='pending_quality' AND evaluation_id IS NULL AND pdf_file_path IS NOT NULL;
