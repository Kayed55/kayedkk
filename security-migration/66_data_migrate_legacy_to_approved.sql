-- ============================================================================
-- Migration 66 (PR #71) — ترحيل الحالات القديمة → 'approved' + DEFAULT
-- Q1 (عدّ الإنتاج): pending_supervisor=27 + pending_quality=5 + NULL=2 = 34 صف للترحيل.
--   (approved=69 و closed=8 لا تُمَسّ.)
-- ملاحظة سلوكية: الصفوف المُرحّلة تأخذ objection_deadline = created_at+24h (غالباً في الماضي)،
--   فتُغلَق تلقائياً (auto-close) عند أول فتح لـcg-week/cg-eval — أي تُنهى الحالات العالقة. مقصود.
-- approved_at = COALESCE(approved_at, now()) — إضافة اتساق فوق سبك #71 (migrated approved بلا timestamp).
-- ============================================================================

BEGIN;

UPDATE public.creative_gene_weekly_status
SET workflow_state    = 'approved',
    objection_deadline = COALESCE(objection_deadline, created_at + interval '24 hours'),
    approved_at        = COALESCE(approved_at, now()),
    updated_at         = now()
WHERE workflow_state IN ('pending_supervisor','pending_quality')
   OR workflow_state IS NULL;

-- DEFAULT مستقبلي على العمود (لو أُدرج صف بلا workflow_state)
ALTER TABLE public.creative_gene_weekly_status
  ALTER COLUMN workflow_state SET DEFAULT 'approved';

-- Self-verify: لا حالات قديمة متبقّية
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left FROM public.creative_gene_weekly_status
   WHERE workflow_state IN ('pending_supervisor','pending_quality') OR workflow_state IS NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'Migration 66 failed — % legacy rows still remain', v_left;
  END IF;
  RAISE NOTICE 'Migration 66 OK — legacy states migrated to approved (0 remain) + DEFAULT approved';
END $$;

COMMIT;

-- Rollback (لا يُعيد الحالات القديمة الأصلية — البيانات وُحِّدت): ALTER TABLE ... ALTER COLUMN workflow_state DROP DEFAULT;
