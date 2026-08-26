-- ============================================================================
-- Migration 74 (Feature 3 / PR #76) — qo_update_cg_evaluation v2 (+ تعديل التاريخ)
--   يمدّد M73: يضيف p_new_week_start لتعديل تاريخ أسبوع تقييم CG بعد إنشائه،
--   من داخل نفس مودال تعديل التقييم (حفظة atomic واحدة).
-- ----------------------------------------------------------------------------
-- الجذر: تاريخ تقييم CG مخزَّن في جدولين (evaluations + creative_gene_weekly_status).
--   Feature 1 (M72) يعدّل التاريخ قبل التقييم فقط (pending_quality). بعد التقييم
--   (evaluation_id != null) لا مسار — هذا الملف يوفّره.
--
-- Option A: DROP للتوقيع القديم (7-args) + CREATE بـ8 params (p_new_week_start
--   في النهاية، DEFAULT NULL). المستدعي الوحيد = handler v=117 (يتحوّل لـv=118).
--
-- منطق التاريخ (خطوة 7.5 + 12.5):
--   • p_new_week_start NULL → لا يُلمس التاريخ (نمط بقية الحقول).
--   • مُرِّر → تطبيع سبت يدوياً (evaluations بلا trigger) → لو = القديم: no-op
--     (date_changed=false) → وإلا: فحص تعارض على القيد الفريد
--     creative_gene_weekly_status(employee_id, week_start) → لو تعارض: رجوع مبكر.
--   • UPDATE evaluations: week_start/week_end + evaluation_date=week_end الجديد.
--   • UPDATE creative_gene_weekly_status منفصلة (trigger M71 يعيد تطبيع week_start).
--   • wf_audit metadata: date_changed/from_date/to_date عند التغيير + pr:76, m:74.
--
-- Anon-Only (REVOKE PUBLIC + GRANT anon بعد DROP). DDL فقط → counts Δ=0. DO $$ ذاتي.
-- ============================================================================

BEGIN;

-- ---- counts قبل (إثبات DDL-only) ------------------------------------------
CREATE TEMP TABLE m74_report(phase text, tbl text, n bigint) ON COMMIT DROP;
INSERT INTO m74_report(phase, tbl, n)
SELECT 'before','evaluations', count(*) FROM public.evaluations
UNION ALL SELECT 'before','creative_gene_weekly_status', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','creative_gene_actions', count(*) FROM public.creative_gene_actions
UNION ALL SELECT 'before','audit_logs', count(*) FROM public.audit_logs
UNION ALL SELECT 'before','users', count(*) FROM public.users;

-- ---- Option A: إسقاط التوقيع القديم (7-args) قبل إعادة الإنشاء بـ8 ----------
DROP FUNCTION IF EXISTS public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean);

-- ---- الدالة (8 params) ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.qo_update_cg_evaluation(
  p_session_token               text,
  p_evaluation_id               bigint,
  p_criteria_scores             jsonb,
  p_evaluation_notes            text    DEFAULT NULL,
  p_pdf_file_path               text    DEFAULT NULL,
  p_pdf_file_name               text    DEFAULT NULL,
  p_confirm_override_supervisor boolean DEFAULT false,
  p_new_week_start              date    DEFAULT NULL
)
 RETURNS TABLE(ok boolean, percentage numeric, grade text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sess      record;
  v_eval      record;
  v_pass      numeric;
  v_template  jsonb;
  v_calc      jsonb;
  v_key       text;
  v_found     boolean;
  c           jsonb;
  v_cw        numeric;
  v_cs        numeric;
  v_sup_cnt   int;
  v_status_id bigint;
  v_wf        text;
  v_actor     text;
  v_emp       text;
  v_file_replaced boolean;
  v_date_changed  boolean := false;
  v_new_ws    date;
  v_new_we    date;
  v_old_ws    date;
  v_allowed   constant text[] := array['admin','quality_officer'];
begin
  -- (1) الجلسة
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid, false) then
    return query select false, null::numeric, null::text, 'انتهت الجلسة أو الرمز غير صالح'::text; return;
  end if;

  -- (2) الصلاحية — الجودة/المدير فقط
  if not (v_sess.role = any(v_allowed)) then
    return query select false, null::numeric, null::text, 'ليس لديك صلاحية لتعديل التقييمات'::text; return;
  end if;

  -- (3) جلب التقييم
  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if v_eval.id is null then
    return query select false, null::numeric, null::text, 'التقييم غير موجود'::text; return;
  end if;

  -- (4) حصر النوع في PDF
  if coalesce(v_eval.template_type,'') <> 'pdf_based_weekly' then
    return query select false, null::numeric, null::text, 'هذه الدالة للتقييمات القائمة على PDF فقط'::text; return;
  end if;

  -- (5) درجات مطلوبة
  if p_criteria_scores is null or jsonb_typeof(p_criteria_scores) <> 'object' or p_criteria_scores = '{}'::jsonb then
    return query select false, null::numeric, null::text, 'درجات المعايير مطلوبة'::text; return;
  end if;

  -- (6) فحص إجراء المشرف النشط
  select count(*) into v_sup_cnt
    from public.creative_gene_actions
   where evaluation_id = p_evaluation_id and supervisor_id is not null and superseded_at is null;

  -- (7) بوابة التأكيد — قبل أي كتابة
  if v_sup_cnt > 0 and not p_confirm_override_supervisor then
    return query select false, null::numeric, null::text, 'SUPERVISOR_ACTION_EXISTS'::text; return;
  end if;

  -- (7.5) معالجة التاريخ — قبل أي كتابة
  v_old_ws := v_eval.week_start;
  if p_new_week_start is not null then
    -- تطبيع يدوي على سبت الأسبوع (evaluations بلا trigger)
    v_new_ws := p_new_week_start - ((extract(dow from p_new_week_start)::int + 1) % 7);
    v_new_we := v_new_ws + 6;
    if v_new_ws is distinct from v_old_ws then
      v_date_changed := true;
      -- فحص التعارض على القيد الفريد الوحيد: creative_gene_weekly_status(employee_id, week_start)
      if exists(
        select 1 from public.creative_gene_weekly_status
         where employee_id = v_eval.employee_id and week_start = v_new_ws and evaluation_id is distinct from p_evaluation_id
      ) then
        return query select false, null::numeric, null::text, 'يوجد أسبوع آخر لهذا الموظف بنفس التاريخ — لا يمكن الدمج'::text; return;
      end if;
    end if;
  end if;

  -- (8) العتبة المجمّدة + النموذج (اللقطة أولاً)
  v_pass := coalesce(v_eval.pass_score_snapshot, public.employee_pass_score(v_eval.employee_id), 85);
  v_template := coalesce(
    v_eval.template_snapshot,
    (select template_jsonb from public.evaluation_templates where template_type='pdf_based_weekly' and is_active limit 1));
  if v_template is null then
    return query select false, null::numeric, null::text, 'تعذّر تحديد نموذج التقييم'::text; return;
  end if;

  -- (9) تحقّق المعايير: كل مفتاح معروف + القيمة ضمن 0..weight
  for v_key in select jsonb_object_keys(p_criteria_scores) loop
    v_found := false;
    for c in select value from jsonb_array_elements(coalesce(v_template->'criteria','[]'::jsonb)) loop
      if (c->>'id') = v_key then
        v_found := true;
        v_cw := coalesce((c->>'weight')::numeric, 0);
        v_cs := coalesce((p_criteria_scores->>v_key)::numeric, 0);
        if v_cs < 0 or v_cs > v_cw then
          return query select false, null::numeric, null::text,
            ('الدرجة المُدخلة ('||v_cs||') خارج النطاق المسموح لمعيار «'||(c->>'name')||'» (0 - '||v_cw||')')::text;
          return;
        end if;
        exit;
      end if;
    end loop;
    if not v_found then
      return query select false, null::numeric, null::text, ('معيار غير معروف في النموذج: '||v_key)::text; return;
    end if;
  end loop;

  -- (10) إعادة الاحتساب بالعتبة المجمّدة
  v_calc := public.compute_pdf_weighted(p_criteria_scores, v_template, v_pass);

  -- (11) صفّ سير العمل (للتدقيق + تحديث التاريخ)
  select id, workflow_state into v_status_id, v_wf
    from public.creative_gene_weekly_status where evaluation_id = p_evaluation_id;

  -- (12) التحديث — الدرجات + الملاحظات + الملف + التاريخ (coalesce يُبقي القديم إن NULL)
  v_file_replaced := (nullif(trim(coalesce(p_pdf_file_path,'')),'') is not null);
  update public.evaluations set
    items               = p_criteria_scores,
    section_scores      = p_criteria_scores,
    total_score         = (v_calc->>'total_score')::numeric,
    percentage          = (v_calc->>'percentage')::numeric,
    grade               = v_calc->>'grade',
    status              = v_calc->>'status',
    evaluation_notes    = coalesce(p_evaluation_notes, evaluation_notes),
    pdf_file_path       = coalesce(nullif(trim(coalesce(p_pdf_file_path,'')),''), pdf_file_path),
    pdf_file_name       = coalesce(nullif(trim(coalesce(p_pdf_file_name,'')),''), pdf_file_name),
    week_start          = case when v_date_changed then v_new_ws else week_start end,
    week_end            = case when v_date_changed then v_new_we else week_end end,
    evaluation_date     = case when v_date_changed then v_new_we else evaluation_date end,  -- يبقى مشتقاً من week_end
    pass_score_snapshot = coalesce(pass_score_snapshot, v_pass),
    updated_at          = now()
  where id = p_evaluation_id;

  -- (12.5) UPDATE سير العمل (منفصلة — trigger M71 يعيد تطبيع week_start idempotent)
  if v_date_changed and v_status_id is not null then
    update public.creative_gene_weekly_status
       set week_start = v_new_ws, week_end = v_new_we, updated_at = now()
     where id = v_status_id;
  end if;

  -- (13) إشعار الموظف
  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), v_eval.employee_id, 'تم تعديل تقييمك الأسبوعي',
    'تم تعديل تقييمك الأسبوعي من قِبَل الإدارة — النتيجة '||(v_calc->>'percentage')||'/100 ('||(v_calc->>'grade')||')',
    case when (v_calc->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', p_evaluation_id, false, now());

  -- (14) wf_audit — لا انتقال حالة؛ التواريخ/الحقول في notes+metadata
  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  select full_name::text into v_emp   from public.users where id = v_eval.employee_id;
  perform public.wf_audit(
    v_status_id, p_evaluation_id, coalesce(v_wf,'approved'), coalesce(v_wf,'approved'), 'cg_evaluation_edit',
    v_sess.user_id, v_sess.role,
    (case when v_sup_cnt > 0
       then 'تعديل تقييم CG #'||p_evaluation_id||' رغم وجود إجراء مشرف مرتبط — النتيجة '||(v_calc->>'percentage')||'/100 ('||(v_calc->>'grade')||')'
       else 'تعديل تقييم CG #'||p_evaluation_id||' — النتيجة '||(v_calc->>'percentage')||'/100 ('||(v_calc->>'grade')||')'
     end || (case when v_date_changed then ' · تعديل التاريخ من '||v_old_ws||' إلى '||v_new_ws else '' end))::text,
    jsonb_build_object(
      'percentage', (v_calc->>'percentage'), 'grade', (v_calc->>'grade'),
      'file_replaced', v_file_replaced,
      'supervisor_action_overridden', (v_sup_cnt > 0),
      'supervisor_action_count', v_sup_cnt,
      'action', 'cg_evaluation_edit', 'pr', 76, 'm', 74)
    || (case when v_date_changed
         then jsonb_build_object('date_changed', true, 'from_date', v_old_ws, 'to_date', v_new_ws)
         else '{}'::jsonb end)
  );

  -- (15) سجلّ التدقيق العام
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'cg_evaluation_edit','evaluation',p_evaluation_id,
    ('تعديل تقييم CG #'||p_evaluation_id||' للموظف '||coalesce(v_emp,'-')||' — النتيجة المُعاد احتسابها '||(v_calc->>'percentage')||'/100 ('||(v_calc->>'grade')||') عتبة '||v_pass
     ||(case when v_file_replaced then ' · استُبدل الملف' else '' end)
     ||(case when v_date_changed then ' · التاريخ '||v_old_ws||' ← '||v_new_ws else '' end)
     ||' — بواسطة '||coalesce(v_actor,'النظام')
     ||(case when v_sup_cnt > 0 then ' — ⚠️ رغم وجود إجراء مشرف مرتبط (تجاوز مُوثّق)' else '' end)),
    now());

  return query select true, (v_calc->>'percentage')::numeric, (v_calc->>'grade')::text, 'تم حفظ التعديلات'::text;
end;
$function$;

-- ---- عقد anon-only صريح (إعادة المنح بعد DROP) -----------------------------
REVOKE ALL ON FUNCTION public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean, date) TO anon, authenticated;

-- ---- counts بعد -----------------------------------------------------------
INSERT INTO m74_report(phase, tbl, n)
SELECT 'after','evaluations', count(*) FROM public.evaluations
UNION ALL SELECT 'after','creative_gene_weekly_status', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','creative_gene_actions', count(*) FROM public.creative_gene_actions
UNION ALL SELECT 'after','audit_logs', count(*) FROM public.audit_logs
UNION ALL SELECT 'after','users', count(*) FROM public.users;

-- ---- التحقق الذاتي (ذرّي) --------------------------------------------------
DO $$
DECLARE
  v_sig8 text := 'public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean, date)';
  v_cnt int;
  r record;
BEGIN
  -- التوقيع الجديد (8-args) موجود
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='qo_update_cg_evaluation'
                 AND pronamespace='public'::regnamespace AND pronargs=8) THEN
    RAISE EXCEPTION 'M74 FAILED — التوقيع 8-args غير موجود';
  END IF;
  -- التوقيع القديم (7-args) أُسقط (لا overload غامض)
  SELECT count(*) INTO v_cnt FROM pg_proc WHERE proname='qo_update_cg_evaluation'
    AND pronamespace='public'::regnamespace;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'M74 FAILED — يوجد % توقيع لـqo_update_cg_evaluation (المتوقّع 1 — أُسقط 7-args؟)', v_cnt;
  END IF;
  -- عقد anon-only
  IF has_function_privilege('public', v_sig8, 'EXECUTE') THEN
    RAISE EXCEPTION 'M74 FAILED — PUBLIC لا يزال يملك EXECUTE';
  END IF;
  IF NOT has_function_privilege('anon', v_sig8, 'EXECUTE') THEN
    RAISE EXCEPTION 'M74 FAILED — anon لا يملك EXECUTE (التطبيق سيتعطّل)';
  END IF;
  -- DDL-only
  FOR r IN
    SELECT b.tbl, b.n AS before_n, a.n AS after_n
      FROM m74_report b JOIN m74_report a ON a.tbl=b.tbl AND a.phase='after'
     WHERE b.phase='before'
  LOOP
    RAISE NOTICE 'M74 count · % : before=% after=% (Δ%)', r.tbl, r.before_n, r.after_n, (r.after_n - r.before_n);
    IF r.before_n <> r.after_n THEN
      RAISE EXCEPTION 'M74 FAILED — تغيّر عدد صفوف % (%→%) — يجب أن تكون DDL فقط', r.tbl, r.before_n, r.after_n;
    END IF;
  END LOOP;
  RAISE NOTICE 'M74 OK — qo_update_cg_evaluation (8-args) مُعرّفة · 7-args مُسقط · anon-only · DDL فقط.';
END $$;

COMMIT;

-- Rollback: DROP FUNCTION IF EXISTS public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean, date);
--   ثم أعِد تشغيل M73 لاستعادة التوقيع 7-args.
