-- ============================================================================
-- Migration 54 (PR #70) — soft-supersede على creative_gene_actions
-- الغرض: عند قبول اعتراض (D6) نُلغي إجراء المشرف "منطقياً" (لا حذف) للحفاظ على المسار الزمني.
--   superseded_at IS NULL = الإجراء النشط الحالي.
-- لا يمسّ بيانات قائمة (الأعمدة nullable) — صفر breaking change.
-- ============================================================================

BEGIN;

ALTER TABLE public.creative_gene_actions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_action_id bigint
    REFERENCES public.creative_gene_actions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cg_actions_active_by_eval
  ON public.creative_gene_actions (evaluation_id)
  WHERE superseded_at IS NULL;

-- Self-verify
DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT COUNT(*) = 2 INTO v_ok
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='creative_gene_actions'
    AND column_name IN ('superseded_at','superseded_by_action_id');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Migration 54 failed — superseded columns not created';
  END IF;
  RAISE NOTICE 'Migration 54 OK — superseded_at + superseded_by_action_id + partial index';
END $$;

COMMIT;

-- Rollback:
-- ALTER TABLE public.creative_gene_actions
--   DROP COLUMN IF EXISTS superseded_by_action_id,
--   DROP COLUMN IF EXISTS superseded_at;
-- DROP INDEX IF EXISTS public.idx_cg_actions_active_by_eval;
