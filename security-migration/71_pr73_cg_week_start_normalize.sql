-- ============================================================================
-- Migration 71 (PR #73) — تطبيع week_start لأسبوع CG على السبت + إصلاح الصفوف العالقة
-- ----------------------------------------------------------------------------
-- الجذر (تشخيص Kayed): create_evaluation_request يحفظ week_start = يوم الرفع كما هو
--   (غير مُطبّع)، بينما create_evaluation (M62) يُطبّعه على سبت الأسبوع قبل الـupsert.
--   فمفتاح ON CONFLICT (employee_id, week_start) لا يتطابق → يُنشأ صفّ approved جديد
--   ويبقى صفّ الرفع الأصلي عالقاً في pending_quality (queue الجودة لا يُفرَّغ).
--
-- لماذا TRIGGER بدل CREATE OR REPLACE للدالتين (انحراف مقصود — للمراجعة):
--   • create_evaluation_request / open_evaluation_request / list_workflow_requests
--     دَين desync — لا مصدر لها في المستودع (scripts/rpc-source-baseline.json).
--     إعادة كتابتها من التوقيع فقط تُخاطر بمنطق الصلاحيات/الإدراج/الإشعار/التدقيق.
--   • trigger على مستوى الجدول يُطبّع كل مسارات الكتابة (الحاضرة والمستقبلية) بلا
--     حاجة لأجسام الدوال، ولا يمسّ أي GRANT (عقد Anon-Only يبقى سليماً — لا RPC يُعاد تعريفه).
--   • create_evaluation (M62) يُطبّع أصلاً؛ الـtrigger يجعله idempotent (لا تغيير مطلوب).
--   BEFORE INSERT يعمل قبل فحص ON CONFLICT، فالقيمة المُطبّعة هي مفتاح التعارض → يتطابق.
--
-- الإصلاح البياني (ديناميكي، آمن ضد قيد الفريدة (employee_id, week_start)):
--   لكل صفّ week_start ليس سبتاً أو سنته مشوّهة (<1900):
--     يُحسب الهدف = (إصلاح السنة إن لزم) ثم تطبيع على السبت.
--     • لا تعارض عند الهدف → ينتقل مكانه (تطبيع).
--     • يتعارض مع صفّ approved (له evaluation_id) → يُغلق العالق: system_close_after_M71.
--     • يتعارض مع صفّ غير approved → يُغلق المكرّر: system_dedup (نُبقي الأحدث — ترتيب الحلقة).
--   لا حذف — إغلاق فقط (workflow_state='closed') + سطر wf_audit لكل تغيير (مسار التدقيق).
--
-- عدّ قبل/بعد لكل الجداول (users, evaluations, objections, creative_gene_objections,
--   creative_gene_weekly_status) لإثبات zero-impact خارج الإصلاح المقصود.
-- BEGIN/COMMIT + DO $$ للتحقق الذاتي (يفشل ذرّياً إن بقي صفّ نشط غير مُطبّع).
-- ============================================================================

BEGIN;

-- ---- تقرير قبل/بعد (يُطبع كنتيجة في نهاية السكربت) --------------------------
CREATE TEMP TABLE m71_report(phase text, tbl text, metric text, n bigint) ON COMMIT DROP;

INSERT INTO m71_report(phase, tbl, metric, n)
SELECT 'before','users','count', count(*) FROM public.users
UNION ALL SELECT 'before','evaluations','count', count(*) FROM public.evaluations
UNION ALL SELECT 'before','objections','count', count(*) FROM public.objections
UNION ALL SELECT 'before','creative_gene_objections','count', count(*) FROM public.creative_gene_objections
UNION ALL SELECT 'before','creative_gene_weekly_status','total', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','creative_gene_weekly_status','pending_quality', count(*) FILTER (WHERE workflow_state='pending_quality') FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','creative_gene_weekly_status','approved', count(*) FILTER (WHERE workflow_state='approved') FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','creative_gene_weekly_status','closed', count(*) FILTER (WHERE workflow_state='closed') FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','creative_gene_weekly_status','non_saturday', count(*) FILTER (WHERE ((extract(dow from week_start)::int + 1) % 7) <> 0) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','creative_gene_weekly_status','corrupt_year', count(*) FILTER (WHERE extract(year from week_start) < 1900) FROM public.creative_gene_weekly_status;

-- ---- (1) الإصلاح البياني الديناميكي ----------------------------------------
DO $$
DECLARE
  v_actor   bigint;
  r         record;
  v_target  date;
  v_dupe    record;
  v_norm int := 0; v_yearfix int := 0; v_close_orphan int := 0; v_dedup int := 0;
BEGIN
  SELECT id INTO v_actor FROM public.users
   WHERE role='admin' AND coalesce(is_active,true) ORDER BY id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'M71 — لا يوجد أدمن نشط لتسجيل الـaudit'; END IF;

  -- الأحدث/الأعلى أولاً ليَحجِز الهدف؛ التالي المكرّر يُغلق
  FOR r IN
    SELECT * FROM public.creative_gene_weekly_status
     WHERE ((extract(dow from week_start)::int + 1) % 7) <> 0     -- ليس سبتاً
        OR extract(year from week_start) < 1900                    -- سنة مشوّهة
     ORDER BY (evaluation_id IS NOT NULL) DESC, updated_at DESC NULLS LAST, id DESC
  LOOP
    -- الهدف: إصلاح السنة المشوّهة (0206→2026) ثم تطبيع على السبت
    v_target := r.week_start;
    IF extract(year from v_target) < 1900 THEN
      v_target := make_date(2026, extract(month from v_target)::int, extract(day from v_target)::int);
    END IF;
    v_target := v_target - ((extract(dow from v_target)::int + 1) % 7);

    IF v_target = r.week_start THEN CONTINUE; END IF;  -- لا تغيير فعلي

    -- هل يوجد صفّ آخر لنفس الموظف عند الهدف؟
    SELECT id, workflow_state, evaluation_id INTO v_dupe
      FROM public.creative_gene_weekly_status
     WHERE employee_id = r.employee_id AND week_start = v_target AND id <> r.id
     ORDER BY (evaluation_id IS NOT NULL) DESC, updated_at DESC NULLS LAST, id DESC
     LIMIT 1;

    IF NOT FOUND THEN
      -- لا تعارض → نقل مكانه (تطبيع)
      PERFORM public.wf_audit(r.id, r.evaluation_id, r.workflow_state, r.workflow_state,
        'system_normalize_week', v_actor, 'admin',
        format('تطبيع week_start %s → %s (M71)', r.week_start, v_target),
        jsonb_build_object('from', r.week_start, 'to', v_target, 'pr', 73, 'm', 71));
      UPDATE public.creative_gene_weekly_status SET week_start = v_target, updated_at = now() WHERE id = r.id;
      v_norm := v_norm + 1;
      IF extract(year from r.week_start) < 1900 THEN v_yearfix := v_yearfix + 1; END IF;
    ELSE
      -- تعارض → أغلق العالق/المكرّر (نُبقي الصفّ عند الهدف)
      IF v_dupe.evaluation_id IS NOT NULL THEN
        PERFORM public.wf_audit(r.id, r.evaluation_id, r.workflow_state, 'closed',
          'system_close_after_M71', v_actor, 'admin',
          format('إغلاق صفّ عالق (%s) — تقييمه على السبت المُطبّع %s موجود في الصفّ id=%s', r.week_start, v_target, v_dupe.id),
          jsonb_build_object('kept_id', v_dupe.id, 'closed_id', r.id, 'target_week', v_target, 'reason', 'orphan_after_week_start_desync', 'pr', 73, 'm', 71));
        v_close_orphan := v_close_orphan + 1;
      ELSE
        PERFORM public.wf_audit(r.id, r.evaluation_id, r.workflow_state, 'closed',
          'system_dedup', v_actor, 'admin',
          format('إغلاق صفّ مكرّر (%s→%s) — نُبقي id=%s', r.week_start, v_target, v_dupe.id),
          jsonb_build_object('kept_id', v_dupe.id, 'closed_id', r.id, 'target_week', v_target, 'pr', 73, 'm', 71));
        v_dedup := v_dedup + 1;
      END IF;
      UPDATE public.creative_gene_weekly_status
         SET workflow_state='closed', approved_at=NULL, objection_deadline=NULL, updated_at=now()
       WHERE id = r.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'M71 repair: normalized=% (year_fixed=%) · closed_orphan=% · dedup=%',
    v_norm, v_yearfix, v_close_orphan, v_dedup;
END $$;

-- ---- (2) trigger التطبيع لكل الكتابات المستقبلية ----------------------------
CREATE OR REPLACE FUNCTION public.cg_normalize_week_start()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.week_start IS NOT NULL THEN
    -- تطبيع على سبت الأسبوع (السبت dow=6 → إزاحة 0) — نفس صيغة create_evaluation/العميل
    NEW.week_start := NEW.week_start - ((extract(dow from NEW.week_start)::int + 1) % 7);
  END IF;
  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public.cg_normalize_week_start() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_cg_normalize_week_start ON public.creative_gene_weekly_status;
CREATE TRIGGER trg_cg_normalize_week_start
  BEFORE INSERT OR UPDATE OF week_start ON public.creative_gene_weekly_status
  FOR EACH ROW EXECUTE FUNCTION public.cg_normalize_week_start();

-- ---- بعد ------------------------------------------------------------------
INSERT INTO m71_report(phase, tbl, metric, n)
SELECT 'after','users','count', count(*) FROM public.users
UNION ALL SELECT 'after','evaluations','count', count(*) FROM public.evaluations
UNION ALL SELECT 'after','objections','count', count(*) FROM public.objections
UNION ALL SELECT 'after','creative_gene_objections','count', count(*) FROM public.creative_gene_objections
UNION ALL SELECT 'after','creative_gene_weekly_status','total', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','creative_gene_weekly_status','pending_quality', count(*) FILTER (WHERE workflow_state='pending_quality') FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','creative_gene_weekly_status','approved', count(*) FILTER (WHERE workflow_state='approved') FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','creative_gene_weekly_status','closed', count(*) FILTER (WHERE workflow_state='closed') FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','creative_gene_weekly_status','non_saturday', count(*) FILTER (WHERE ((extract(dow from week_start)::int + 1) % 7) <> 0) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','creative_gene_weekly_status','corrupt_year', count(*) FILTER (WHERE extract(year from week_start) < 1900) FROM public.creative_gene_weekly_status;

-- ---- (3) التحقق الذاتي (ذرّي) ----------------------------------------------
DO $$
DECLARE
  v_bad_active   int;    -- صفّ نشط (غير مغلق) غير مُطبّع على السبت
  v_untouched    record;
  b_users bigint; a_users bigint; b_ev bigint; a_ev bigint; b_ob bigint; a_ob bigint; b_cgo bigint; a_cgo bigint;
  b_tot bigint; a_tot bigint;
  v_trg int;
BEGIN
  -- (أ) لا صفّ نشط (workflow_state <> 'closed') يبقى غير مُطبّع على السبت
  SELECT count(*) INTO v_bad_active FROM public.creative_gene_weekly_status
   WHERE workflow_state <> 'closed'
     AND ((extract(dow from week_start)::int + 1) % 7) <> 0;
  IF v_bad_active <> 0 THEN
    RAISE EXCEPTION 'M71 FAILED — بقي % صفّاً نشطاً غير مُطبّع على السبت', v_bad_active;
  END IF;

  -- (ب) zero-impact: users/evaluations/objections/creative_gene_objections بلا تغيير + total غير متغيّر (إغلاق فقط)
  SELECT n INTO b_users FROM m71_report WHERE phase='before' AND tbl='users';
  SELECT n INTO a_users FROM m71_report WHERE phase='after'  AND tbl='users';
  SELECT n INTO b_ev FROM m71_report WHERE phase='before' AND tbl='evaluations';
  SELECT n INTO a_ev FROM m71_report WHERE phase='after'  AND tbl='evaluations';
  SELECT n INTO b_ob FROM m71_report WHERE phase='before' AND tbl='objections';
  SELECT n INTO a_ob FROM m71_report WHERE phase='after'  AND tbl='objections';
  SELECT n INTO b_cgo FROM m71_report WHERE phase='before' AND tbl='creative_gene_objections';
  SELECT n INTO a_cgo FROM m71_report WHERE phase='after'  AND tbl='creative_gene_objections';
  SELECT n INTO b_tot FROM m71_report WHERE phase='before' AND tbl='creative_gene_weekly_status' AND metric='total';
  SELECT n INTO a_tot FROM m71_report WHERE phase='after'  AND tbl='creative_gene_weekly_status' AND metric='total';

  IF b_users<>a_users OR b_ev<>a_ev OR b_ob<>a_ob OR b_cgo<>a_cgo OR b_tot<>a_tot THEN
    RAISE EXCEPTION 'M71 FAILED — تغيّر عدد صفوف خارج النطاق (users %→%, evals %→%, obj %→%, cg_obj %→%, cg_total %→%)',
      b_users,a_users, b_ev,a_ev, b_ob,a_ob, b_cgo,a_cgo, b_tot,a_tot;
  END IF;

  -- (ج) الـtrigger موجود
  SELECT count(*) INTO v_trg FROM pg_trigger WHERE tgname='trg_cg_normalize_week_start' AND NOT tgisinternal;
  IF v_trg <> 1 THEN RAISE EXCEPTION 'M71 FAILED — trigger التطبيع غير موجود'; END IF;

  RAISE NOTICE 'M71 OK — لا صفّ نشط غير مُطبّع · zero-impact مؤكّد · trigger مثبّت.';

  -- طباعة عدّ قبل/بعد في Notices (مضمون الظهور بصرف النظر عن سلوك المحرّر)
  FOR v_untouched IN
    SELECT b.tbl, b.metric, b.n AS before_n, a.n AS after_n, (a.n - b.n) AS delta
      FROM m71_report b JOIN m71_report a ON a.tbl=b.tbl AND a.metric=b.metric AND a.phase='after'
     WHERE b.phase='before' ORDER BY b.tbl, b.metric
  LOOP
    RAISE NOTICE 'M71 count · %/% : before=% after=% (Δ%)',
      v_untouched.tbl, v_untouched.metric, v_untouched.before_n, v_untouched.after_n, v_untouched.delta;
  END LOOP;

  -- تنويه للمراجعة: صفوف مغلقة بسنة مشوّهة تُركت كما هي (خارج التدفّق، فريدة، لا تُحرّك لأن الهدف محجوز بصفّ approved)
  FOR v_untouched IN
    SELECT id, employee_id, week_start FROM public.creative_gene_weekly_status
     WHERE extract(year from week_start) < 1900
  LOOP
    RAISE NOTICE 'M71 تنويه — صفّ id=% (emp=%) بسنة مشوّهة % مغلق ومتروك (هدفه 2026 محجوز بصفّ approved). قرّر لاحقاً: ترك/حذف.',
      v_untouched.id, v_untouched.employee_id, v_untouched.week_start;
  END LOOP;
END $$;

-- النتيجة المرئية: عدّ قبل/بعد جنباً إلى جنب
SELECT b.tbl, b.metric, b.n AS before_n, a.n AS after_n, (a.n - b.n) AS delta
FROM m71_report b
JOIN m71_report a ON a.tbl=b.tbl AND a.metric=b.metric AND a.phase='after'
WHERE b.phase='before'
ORDER BY b.tbl, b.metric;

COMMIT;

-- Rollback (يدوي، غير مُوصى):
--   DROP TRIGGER IF EXISTS trg_cg_normalize_week_start ON public.creative_gene_weekly_status;
--   DROP FUNCTION IF EXISTS public.cg_normalize_week_start();
--   استعادة week_start الأصلية غير ممكنة تلقائياً — راجع wf_audit (action='system_normalize_week').
