-- ============================================================================
-- Migration 61 (PR #70) — REVOKE PUBLIC على 3 دوال CG لا تزال تحمل المنح الافتراضي
-- السبب: take_action / raise_objection / cg_set_eval_action دوال desync لم يسبق REVOKE PUBLIC عليها؛
--   CREATE OR REPLACE يحفظ المنح، فبقيت public_can_call=true.
-- الأمان: verify_session داخلها يفرض المصادقة أصلاً (ليست ثغرة وصول) — هذا تشديد دفاع-في-العمق.
-- ⚠️ حرج: نمنح anon صراحةً بعد REVOKE PUBLIC (العميل anon-model) وإلا يتعطّل التطبيق.
-- التواقيع مؤكَّدة من أجسام الإنتاج (CSV 2026-08-06، md5 مطابق).
-- ============================================================================

BEGIN;

-- take_action(text, bigint, text, text, bigint)
REVOKE EXECUTE ON FUNCTION public.take_action(text, bigint, text, text, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.take_action(text, bigint, text, text, bigint) TO anon, authenticated;

-- raise_objection(text, bigint, text)
REVOKE EXECUTE ON FUNCTION public.raise_objection(text, bigint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.raise_objection(text, bigint, text) TO anon, authenticated;

-- cg_set_eval_action(text, bigint, text, text)
REVOKE EXECUTE ON FUNCTION public.cg_set_eval_action(text, bigint, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cg_set_eval_action(text, bigint, text, text) TO anon, authenticated;

-- Self-verify: PUBLIC=false و anon=true للثلاثة (وإلا تراجع)
DO $$
DECLARE
  v_sigs text[] := ARRAY[
    'public.take_action(text, bigint, text, text, bigint)',
    'public.raise_objection(text, bigint, text)',
    'public.cg_set_eval_action(text, bigint, text, text)'
  ];
  s text;
BEGIN
  FOREACH s IN ARRAY v_sigs LOOP
    IF has_function_privilege('public', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 61 failed — PUBLIC still can execute %', s;
    END IF;
    IF NOT has_function_privilege('anon', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 61 failed — anon cannot execute % (app would break)', s;
    END IF;
  END LOOP;
  RAISE NOTICE 'Migration 61 OK — PUBLIC revoked, anon retained on take_action / raise_objection / cg_set_eval_action';
END $$;

COMMIT;

-- Rollback (غير مُوصى — يعيد الثغرة الدفاعية):
-- GRANT EXECUTE ON FUNCTION public.take_action(text, bigint, text, text, bigint) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.raise_objection(text, bigint, text) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.cg_set_eval_action(text, bigint, text, text) TO PUBLIC;
