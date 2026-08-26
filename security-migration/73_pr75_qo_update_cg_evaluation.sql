-- ============================================================================
-- Migration 73 (Feature 2 / PR #75) — qo_update_cg_evaluation
--   الجودة/المدير يعدّلون تقييم Creative Gene (درجات + ملاحظات + استبدال الملف)
--   من صفحة «التقييمات» مباشرة، مع تحذير/توثيق إن وُجد إجراء مشرف مرتبط.
-- ----------------------------------------------------------------------------
-- superset لـM31 (admin_update_cg_evaluation): يضيف (أ) استبدال ملف PDF،
--   (ب) فحص إجراء المشرف النشط + بوابة تأكيد، (ج) wf_audit. M31 يبقى معرّفاً
--   لكنه DEPRECATED (يُعلَّم أدناه) — العميل يتحوّل لهذا الـRPC.
--
-- المنطق: verify_session → role∈{admin,quality_officer} → التقييم موجود +
--   pdf_based_weekly → فحص إجراء المشرف (supervisor_id NOT NULL AND superseded_at
--   IS NULL) → لو موجود و confirm=false: يُرجع 'SUPERVISOR_ACTION_EXISTS' (قبل أي
--   كتابة) → إعادة احتساب compute_pdf_weighted بالعتبة المجمّدة → UPDATE evaluations
--   (الدرجات + الملاحظات + الملف coalesce) → notifications → wf_audit('cg_evaluation_edit')
--   → audit_logs. Anon-Only (REVOKE PUBLIC + GRANT anon).
--
-- DDL فقط (يُعرّف الدالة، لا يستدعيها) → counts قبل/بعد لإثبات صفر تغيير بيانات.
-- BEGIN/COMMIT + DO $$ للتحقق الذاتي.
-- ============================================================================

BEGIN;

-- ---- counts قبل (إثبات DDL-only) ------------------------------------------
CREATE TEMP TABLE m73_report(phase text, tbl text, n bigint) ON COMMIT DROP;
INSERT INTO m73_report(phase, tbl, n)
SELECT 'before','evaluations', count(*) FROM public.evaluations
UNION ALL SELECT 'before','creative_gene_weekly_status', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','creative_gene_actions', count(*) FROM public.creative_gene_actions
UNION ALL SELECT 'before','audit_logs', count(*) FROM public.audit_logs
UNION ALL SELECT 'before','users', count(*) FROM public.users;

-- ---- الدالة ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qo_update_cg_evaluation(
  p_session_token               text,
  p_evaluation_id               bigint,
  p_criteria_scores             jsonb,
  p_evaluation_notes            text    DEFAULT NULL,
  p_pdf_file_path               text    DEFAULT NULL,
  p_pdf_file_name               text    DEFAULT NULL,
  p_confirm_override_supervisor boolean DEFAULT false
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

  -- (11) صفّ سير العمل (للتدقيق)
  select id, workflow_state into v_status_id, v_wf
    from public.creative_gene_weekly_status where evaluation_id = p_evaluation_id;

  -- (12) التحديث — الدرجات + الملاحظات + الملف (coalesce يُبقي القديم إن NULL)
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
    pass_score_snapshot = coalesce(pass_score_snapshot, v_pass),
    updated_at          = now()
  where id = p_evaluation_id;

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
     end)::text,
    jsonb_build_object(
      'percentage', (v_calc->>'percentage'), 'grade', (v_calc->>'grade'),
      'file_replaced', v_file_replaced,
      'supervisor_action_overridden', (v_sup_cnt > 0),
      'supervisor_action_count', v_sup_cnt,
      'action', 'cg_evaluation_edit', 'pr', 75, 'm', 73)
  );

  -- (15) سجلّ التدقيق العام
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'cg_evaluation_edit','evaluation',p_evaluation_id,
    ('تعديل تقييم CG #'||p_evaluation_id||' للموظف '||coalesce(v_emp,'-')||' — النتيجة المُعاد احتسابها '||(v_calc->>'percentage')||'/100 ('||(v_calc->>'grade')||') عتبة '||v_pass
     ||(case when v_file_replaced then ' · استُبدل الملف' else '' end)
     ||' — بواسطة '||coalesce(v_actor,'النظام')
     ||(case when v_sup_cnt > 0 then ' — ⚠️ رغم وجود إجراء مشرف مرتبط (تجاوز مُوثّق)' else '' end)),
    now());

  return query select true, (v_calc->>'percentage')::numeric, (v_calc->>'grade')::text, 'تم حفظ التعديلات'::text;
end;
$function$;

-- ---- عقد anon-only صريح ----------------------------------------------------
REVOKE ALL ON FUNCTION public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean) TO anon, authenticated;

-- ---- علامة DEPRECATED على M31 (يبقى معرّفاً للتوافق — العميل تحوّل لـqo_update_cg_evaluation) ----
COMMENT ON FUNCTION public.admin_update_cg_evaluation(text, bigint, jsonb, text) IS
  'DEPRECATED (PR#75/M73): استُبدل بـqo_update_cg_evaluation (يضيف استبدال الملف + فحص إجراء المشرف + wf_audit). يبقى للتوافق؛ لا يستدعيه العميل.';

-- ---- counts بعد -----------------------------------------------------------
INSERT INTO m73_report(phase, tbl, n)
SELECT 'after','evaluations', count(*) FROM public.evaluations
UNION ALL SELECT 'after','creative_gene_weekly_status', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','creative_gene_actions', count(*) FROM public.creative_gene_actions
UNION ALL SELECT 'after','audit_logs', count(*) FROM public.audit_logs
UNION ALL SELECT 'after','users', count(*) FROM public.users;

-- ---- التحقق الذاتي (ذرّي) --------------------------------------------------
DO $$
DECLARE
  v_sig text := 'public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean)';
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='qo_update_cg_evaluation' AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'M73 FAILED — qo_update_cg_evaluation غير موجودة';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'M73 FAILED — PUBLIC لا يزال يملك EXECUTE';
  END IF;
  IF NOT has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'M73 FAILED — anon لا يملك EXECUTE (التطبيق سيتعطّل)';
  END IF;
  FOR r IN
    SELECT b.tbl, b.n AS before_n, a.n AS after_n
      FROM m73_report b JOIN m73_report a ON a.tbl=b.tbl AND a.phase='after'
     WHERE b.phase='before'
  LOOP
    RAISE NOTICE 'M73 count · % : before=% after=% (Δ%)', r.tbl, r.before_n, r.after_n, (r.after_n - r.before_n);
    IF r.before_n <> r.after_n THEN
      RAISE EXCEPTION 'M73 FAILED — تغيّر عدد صفوف % (%→%) — يجب أن تكون DDL فقط', r.tbl, r.before_n, r.after_n;
    END IF;
  END LOOP;
  RAISE NOTICE 'M73 OK — qo_update_cg_evaluation مُعرّفة · anon-only · DDL فقط (صفر تغيير بيانات).';
END $$;

COMMIT;

-- Rollback: DROP FUNCTION IF EXISTS public.qo_update_cg_evaluation(text, bigint, jsonb, text, text, text, boolean);
--           COMMENT ON FUNCTION public.admin_update_cg_evaluation(text, bigint, jsonb, text) IS NULL;
