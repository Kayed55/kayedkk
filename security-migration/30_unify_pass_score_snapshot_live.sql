-- ============================================================
-- ملف 30: توحيد pass_score_snapshot عبر الـ overloads الحيّة
-- ============================================================
-- السياق: ملف 29 عدَّل overloads ميتة (بدون session_token). هذا الملف يعدّل
-- الـ overloads الحيّة التي يستدعيها التطبيق فعلاً:
--   • create_evaluation (18 معاملاً — يبدأ بـ p_session_token text)
--   • admin_update_evaluation (12 معاملاً — يبدأ بـ p_session_token text)
--
-- المهام:
--   1) توسيع compute_evaluation_scores_v2 و compute_pdf_weighted لقبول
--      p_pass_score كوسيط اختياري (افتراضي 85) — DROP+CREATE للحفاظ على
--      نفس السلوك مع المستدعين القدامى.
--   2) create_evaluation (18) → حساب v_pass عند الإنشاء + تمريره للحساب
--      + تخزينه في pass_score_snapshot (كلا فرعَي CG ومحزم).
--   3) admin_update_evaluation (12) → تجميد v_pass من snapshot الموجود
--      (أو من الموظف الأصلي احتياطاً) + تمريره للحساب + كتابته إن كان NULL.
--
-- ملاحظات أمان: كل الـ CREATE OR REPLACE للـ callers تحافظ على نفس التوقيع
-- بالضبط (لا overload جديد). دوال الحساب تُعاد ببناء جديد بإضافة معامل
-- ذي قيمة افتراضية — الاستدعاءات القديمة (بدون تمرير 3 معاملات) تبقى تعمل.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) compute_evaluation_scores_v2 — إضافة p_pass_score
-- ============================================================
DROP FUNCTION IF EXISTS public.compute_evaluation_scores_v2(jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.compute_evaluation_scores_v2(
  p_items       jsonb,
  p_template    jsonb,
  p_pass_score  numeric DEFAULT 85
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_crit jsonb; v_ok text; v_err text; v_na text;
  v_section jsonb; v_sub jsonb; v_item jsonb;
  v_total numeric := 0; v_sscore numeric; v_sstotal numeric;
  v_applicable int; v_correct int; v_haserror boolean; v_ans text;
  v_scores jsonb := '{}'::jsonb; v_pct numeric; v_grade text;
  v_pass numeric;
begin
  v_pass := coalesce(p_pass_score, 85);
  v_crit := p_template;
  if v_crit is null then return jsonb_build_object('error','no_criteria'); end if;
  v_ok := v_crit->'answers'->>'OK'; v_err := v_crit->'answers'->>'ERR'; v_na := v_crit->'answers'->>'NA';
  if p_items is null or jsonb_typeof(p_items) <> 'object' then p_items := '{}'::jsonb; end if;
  for v_section in select value from jsonb_array_elements(v_crit->'sections') loop
    if (v_section->>'type') = 'critical' then
      v_haserror := false;
      for v_sub in select value from jsonb_array_elements(v_section->'subsections') loop
        for v_item in select value from jsonb_array_elements(v_sub->'items') loop
          v_ans := coalesce(p_items->>(v_item->>'key'), v_ok);
          if v_ans = v_err then v_haserror := true; end if;
        end loop;
      end loop;
      v_sscore := case when v_haserror then 0 else (v_section->>'weight')::numeric end;
    else
      v_sstotal := 0;
      for v_sub in select value from jsonb_array_elements(v_section->'subsections') loop
        v_applicable := 0; v_correct := 0;
        for v_item in select value from jsonb_array_elements(v_sub->'items') loop
          v_ans := coalesce(p_items->>(v_item->>'key'), v_ok);
          if v_ans <> v_na then v_applicable := v_applicable + 1; end if;
          if v_ans = v_ok then v_correct := v_correct + 1; end if;
        end loop;
        if v_applicable > 0 then v_sstotal := v_sstotal + (v_correct::numeric / v_applicable) * (v_sub->>'weight')::numeric;
        else v_sstotal := v_sstotal + (v_sub->>'weight')::numeric; end if;
      end loop;
      v_sscore := round(v_sstotal * 10) / 10;
    end if;
    v_scores := v_scores || jsonb_build_object(v_section->>'key', v_sscore);
    v_total  := v_total + v_sscore;
  end loop;
  v_total := round(v_total * 10) / 10; v_pct := v_total;
  v_grade := case when v_pct >= v_pass then 'ناجح' else 'راسب' end;
  return jsonb_build_object('section_scores', v_scores, 'total_score', v_total, 'percentage', v_pct, 'grade', v_grade, 'status', v_grade);
end; $function$;

-- ★ ملف 30: تُستدعى داخلياً فقط (من الدوال الحيّة SECURITY DEFINER) — إلغاء التنفيذ العام (نمط ملف 29)
REVOKE ALL ON FUNCTION public.compute_evaluation_scores_v2(jsonb, jsonb, numeric) FROM public, anon, authenticated;


-- ============================================================
-- 2) compute_pdf_weighted — إضافة p_pass_score
-- ============================================================
DROP FUNCTION IF EXISTS public.compute_pdf_weighted(jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.compute_pdf_weighted(
  p_scores      jsonb,
  p_template    jsonb,
  p_pass_score  numeric DEFAULT 85
)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare c jsonb; v numeric; w numeric; v_sum numeric := 0; v_final numeric; v_grade text;
  v_pass numeric;
begin
  v_pass := coalesce(p_pass_score, 85);
  for c in select value from jsonb_array_elements(coalesce(p_template->'criteria','[]'::jsonb)) loop
    w := coalesce((c->>'weight')::numeric, 0);
    v := least(w, greatest(0, coalesce((p_scores->>(c->>'id'))::numeric, 0)));
    v_sum := v_sum + v;
  end loop;
  v_final := round(v_sum, 2);
  v_grade := case when v_final >= v_pass then 'ناجح' else 'راسب' end;
  return jsonb_build_object('total_score', v_final, 'percentage', v_final, 'grade', v_grade, 'status', v_grade, 'section_scores', p_scores);
end; $function$;

-- ★ ملف 30: تُستدعى داخلياً فقط (من الدوال الحيّة SECURITY DEFINER) — إلغاء التنفيذ العام (نمط ملف 29)
REVOKE ALL ON FUNCTION public.compute_pdf_weighted(jsonb, jsonb, numeric) FROM public, anon, authenticated;


-- ============================================================
-- 3) create_evaluation (18 معاملاً — الحيّة) — snapshot عند الإنشاء
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_evaluation(
  p_session_token           text,
  p_employee_id             bigint,
  p_evaluation_date         date,
  p_observed_issue          text    DEFAULT NULL::text,
  p_observed_issue_other    text    DEFAULT NULL::text,
  p_action_taken            text    DEFAULT NULL::text,
  p_action_taken_other      text    DEFAULT NULL::text,
  p_notes                   text    DEFAULT NULL::text,
  p_items                   jsonb   DEFAULT '{}'::jsonb,
  p_communication_type      text    DEFAULT NULL::text,
  p_communication_reference text    DEFAULT NULL::text,
  p_score                   numeric DEFAULT NULL::numeric,
  p_pdf_file_path           text    DEFAULT NULL::text,
  p_pdf_file_name           text    DEFAULT NULL::text,
  p_evaluation_notes        text    DEFAULT NULL::text,
  p_week_start              date    DEFAULT NULL::date,
  p_week_end                date    DEFAULT NULL::date,
  p_criteria_scores         jsonb   DEFAULT NULL::jsonb
)
 RETURNS TABLE(ok boolean, evaluation_id bigint, percentage numeric, grade text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_actor text; v_emp text; v_scores jsonb; v_id bigint; v_call text;
  v_dept bigint; v_job text; v_template jsonb; v_tmpl_ver int; v_type text; v_ws date; v_we date;
  v_up_at timestamptz; v_up_by int; v_items jsonb; c jsonb; v_cs numeric; v_cw numeric; v_status_id bigint;
  v_pass numeric;  -- ★ ملف 30
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::numeric,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::bigint,null::numeric,null::text,'ليس لديك صلاحية لإنشاء تقييم'::text; return; end if;
  if p_employee_id is null or p_evaluation_date is null then return query select false,null::bigint,null::numeric,null::text,'الموظف والتاريخ مطلوبان'::text; return; end if;

  select department_id, job_role into v_dept, v_job from public.users where id = p_employee_id;
  if v_dept is null then return query select false,null::bigint,null::numeric,null::text,'الموظف غير مرتبط بقسم — حدّد قسمه أولاً'::text; return; end if;
  select template_type into v_type from public.evaluation_templates where department_id=v_dept and is_active order by (job_role is not null) limit 1;
  if v_type is null then return query select false,null::bigint,null::numeric,null::text,'لا يوجد نموذج تقييم لقسم هذا الموظف'::text; return; end if;

  -- ★ ملف 30: حساب pass_score من قسم الموظف (fallback = 85)
  v_pass := coalesce(public.employee_pass_score(p_employee_id), 85);

  if v_type = 'pdf_based_weekly' then
    if coalesce(trim(v_job),'') = '' then
      select full_name::text into v_emp from public.users where id=p_employee_id;
      return query select false,null::bigint,null::numeric,null::text,('لا يمكن إنشاء التقييم — الموظف '||coalesce(v_emp,'')||' بلا مسمى وظيفي. الرجاء تعيين المسمى أولاً من إدارة الموظفين')::text; return;
    end if;
    select template_jsonb, version into v_template, v_tmpl_ver from public.evaluation_templates where department_id=v_dept and job_role=v_job and is_active limit 1;
    if v_template is null then
      select template_jsonb, version into v_template, v_tmpl_ver from public.evaluation_templates where department_id=v_dept and job_role is null and is_active limit 1;
    end if;
    if v_template is null then return query select false,null::bigint,null::numeric,null::text,('لا يوجد نموذج للمسمى '||v_job||' ولا نموذج افتراضي')::text; return; end if;

    if coalesce(trim(p_pdf_file_path),'') = '' then return query select false,null::bigint,null::numeric,null::text,'الرجاء رفع ملف PDF أولاً'::text; return; end if;
    v_ws := coalesce(p_week_start, public.week_start_saturday());
    v_we := coalesce(p_week_end, v_ws + 6);
    if exists(select 1 from public.creative_gene_weekly_status where employee_id=p_employee_id and week_start=v_ws and status in ('evaluated','objection_raised','objection_reviewed','action_taken')) then
      return query select false,null::bigint,null::numeric,null::text,'تم تقييم هذا الأسبوع مسبقاً — افتح البوابة أو احذف التقييم لإعادته'::text; return;
    end if;
    if p_criteria_scores is null or jsonb_typeof(p_criteria_scores) <> 'object' or p_criteria_scores = '{}'::jsonb then
      return query select false,null::bigint,null::numeric,null::text,'درجات المعايير مطلوبة'::text; return;
    end if;
    for c in select value from jsonb_array_elements(coalesce(v_template->'criteria','[]'::jsonb)) loop
      v_cw := coalesce((c->>'weight')::numeric,0);
      v_cs := coalesce((p_criteria_scores->>(c->>'id'))::numeric,0);
      if v_cs > v_cw then
        return query select false,null::bigint,null::numeric,null::text,('الدرجة المُدخلة ('||v_cs||') تتجاوز الحد الأقصى لمعيار «'||(c->>'name')||'» ('||v_cw||')')::text; return;
      end if;
    end loop;
    v_template := coalesce(v_template,'{}'::jsonb) || jsonb_build_object('job_role', v_job);
    v_scores := public.compute_pdf_weighted(p_criteria_scores, v_template, v_pass);  -- ★ ملف 30
    v_items := p_criteria_scores;
    select pdf_uploaded_at, pdf_uploaded_by into v_up_at, v_up_by from public.creative_gene_weekly_status where employee_id = p_employee_id and week_start = v_ws;
    v_id := (select coalesce(max(id),0)+1 from public.evaluations);
    insert into public.evaluations(id, employee_id, evaluator_id, evaluation_date, items, section_scores,
      total_score, percentage, grade, status, approved,
      pdf_file_path, pdf_file_name, pdf_uploaded_at, pdf_uploaded_by, evaluation_notes, week_start, week_end,
      template_snapshot, template_version, template_type,
      pass_score_snapshot,                                                              -- ★ ملف 30
      created_at, updated_at)
    values(v_id, p_employee_id, v_sess.user_id, v_we, v_items, v_scores->'section_scores',
      (v_scores->>'total_score')::numeric, (v_scores->>'percentage')::numeric, v_scores->>'grade', v_scores->>'status', false,
      trim(p_pdf_file_path), p_pdf_file_name, coalesce(v_up_at, now()), coalesce(v_up_by, p_employee_id::int),
      nullif(trim(coalesce(p_evaluation_notes,'')),''), v_ws, v_we,
      v_template, v_tmpl_ver, 'pdf_based_weekly',
      v_pass,                                                                           -- ★ ملف 30
      now(), now());
    insert into public.creative_gene_weekly_status(employee_id, week_start, week_end, status, workflow_state, evaluation_id, pdf_file_path, pdf_uploaded_at, pdf_uploaded_by, updated_at)
    values(p_employee_id, v_ws, v_we, 'evaluated', 'pending_supervisor', v_id, trim(p_pdf_file_path), coalesce(v_up_at, now()), coalesce(v_up_by, p_employee_id::int), now())
    on conflict (employee_id, week_start) do update set status='evaluated', workflow_state='pending_supervisor', evaluation_id=v_id, updated_at=now()
    returning id into v_status_id;
    perform public.wf_audit(v_status_id, v_id, 'pending_quality', 'pending_supervisor', 'evaluate', v_sess.user_id, v_sess.role, null, jsonb_build_object('percentage', (v_scores->>'percentage')));
    insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
    values((select coalesce(max(id),0)+1 from public.notifications), p_employee_id, 'تم تقييم أسبوعك',
      'نتيجة تقييمك الأسبوعي '||(v_scores->>'percentage')||' / 100 ('||(v_scores->>'grade')||')',
      case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', v_id, false, now());
    select full_name::text into v_actor from public.users where id = v_sess.user_id;
    select full_name::text into v_emp   from public.users where id = p_employee_id;
    insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
    values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
      'create_evaluation','evaluation',v_id,'تقييم PDF #'||v_id||' للموظف '||coalesce(v_emp,'-')||' ('||v_job||') - '||(v_scores->>'percentage')||'/100 — بواسطة '||coalesce(v_actor,'النظام'),now());
    return query select true, v_id, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم إنشاء تقييم PDF'::text;
    return;
  end if;

  -- ===== مسار محزم (section_based) =====
  select template_jsonb, version into v_template, v_tmpl_ver from public.evaluation_templates where department_id=v_dept and is_active limit 1;
  if v_type <> 'section_based' then return query select false,null::bigint,null::numeric,null::text,'نموذج هذا القسم غير مدعوم في هذا المسار'::text; return; end if;
  if p_communication_type is null or p_communication_type not in ('chat','call') then return query select false,null::bigint,null::numeric,null::text,'نوع التواصل مطلوب (محادثة/اتصال)'::text; return; end if;
  if coalesce(trim(p_communication_reference),'') = '' then return query select false,null::bigint,null::numeric,null::text,'مرجع التواصل (الرابط/الكود) مطلوب'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then p_items := '{}'::jsonb; end if;
  v_scores := public.compute_evaluation_scores_v2(p_items, v_template, v_pass);  -- ★ ملف 30
  if v_scores ? 'error' then return query select false,null::bigint,null::numeric,null::text,'تعذّر احتساب الدرجة'::text; return; end if;
  v_id  := (select coalesce(max(id),0)+1 from public.evaluations);
  v_call := case when p_observed_issue = 'أخرى' then coalesce(p_observed_issue_other, p_observed_issue) else p_observed_issue end;
  insert into public.evaluations(id, employee_id, evaluator_id, evaluation_date, call_type,
    observed_issue, observed_issue_other, action_taken, action_taken_other,
    supervisor_action, supervisor_action_other, supervisor_notes, supervisor_action_by, supervisor_action_by_name, supervisor_action_at,
    notes, items, section_scores, total_score, percentage, grade, status, approved,
    communication_type, communication_reference, template_snapshot, template_version, template_type,
    pass_score_snapshot,                                                                -- ★ ملف 30
    created_at, updated_at)
  values(v_id, p_employee_id, v_sess.user_id, p_evaluation_date, coalesce(v_call,''),
    coalesce(p_observed_issue,''), coalesce(p_observed_issue_other,''), coalesce(p_action_taken,''), coalesce(p_action_taken_other,''),
    '', '', '', null, '', null,
    coalesce(p_notes,''), p_items, v_scores->'section_scores', (v_scores->>'total_score')::numeric, (v_scores->>'percentage')::numeric, v_scores->>'grade', v_scores->>'status', false,
    p_communication_type, trim(p_communication_reference), v_template, v_tmpl_ver, v_type,
    v_pass,                                                                             -- ★ ملف 30
    now(), now());
  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), p_employee_id, 'تم استلام تقييم جديد',
    'تم تقييمك بنسبة '||(v_scores->>'percentage')||'% - '||(v_scores->>'grade'),
    case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', v_id, false, now());
  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  select full_name::text into v_emp   from public.users where id = p_employee_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'create_evaluation','evaluation',v_id,'إنشاء تقييم #'||v_id||' للموظف '||coalesce(v_emp,'-')||' - '||(v_scores->>'percentage')||'% — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true, v_id, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم إنشاء التقييم'::text;
end; $function$;


-- ============================================================
-- 4) admin_update_evaluation (12 معاملاً — الحيّة) — تجميد snapshot
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_update_evaluation(
  p_session_token           text,
  p_eval_id                 bigint,
  p_employee_id             bigint DEFAULT NULL::bigint,
  p_evaluation_date         date   DEFAULT NULL::date,
  p_observed_issue          text   DEFAULT NULL::text,
  p_observed_issue_other    text   DEFAULT NULL::text,
  p_action_taken            text   DEFAULT NULL::text,
  p_action_taken_other      text   DEFAULT NULL::text,
  p_notes                   text   DEFAULT NULL::text,
  p_items                   jsonb  DEFAULT NULL::jsonb,
  p_communication_type      text   DEFAULT NULL::text,
  p_communication_reference text   DEFAULT NULL::text
)
 RETURNS TABLE(ok boolean, percentage numeric, grade text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_actor text; v_eval public.evaluations; v_scores jsonb; v_call_type text; v_template jsonb;
  v_pass numeric;  -- ★ ملف 30
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::numeric,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::numeric,null::text,'ليس لديك صلاحية لتعديل التقييمات'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then return query select false,null::numeric,null::text,'التقييم غير موجود'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then return query select false,null::numeric,null::text,'بيانات البنود غير صالحة'::text; return; end if;
  if p_communication_type is not null and p_communication_type not in ('chat','call') then return query select false,null::numeric,null::text,'نوع التواصل غير صالح'::text; return; end if;

  v_template := coalesce(v_eval.template_snapshot, (select template_jsonb from public.evaluation_templates where template_type='section_based' and is_active limit 1));

  -- ★ ملف 30: تجميد pass_score — snapshot الموجود أولاً، وإلا من الموظف الأصلي
  v_pass := coalesce(v_eval.pass_score_snapshot, public.employee_pass_score(v_eval.employee_id), 85);

  v_scores := public.compute_evaluation_scores_v2(p_items, v_template, v_pass);  -- ★ ملف 30
  if v_scores ? 'error' then return query select false,null::numeric,null::text,'تعذّر احتساب الدرجة (معايير غير متوفّرة)'::text; return; end if;

  v_call_type := case when p_observed_issue = 'أخرى' then coalesce(p_observed_issue_other, p_observed_issue) else p_observed_issue end;
  update public.evaluations set
    employee_id=coalesce(p_employee_id, employee_id), evaluation_date=coalesce(p_evaluation_date, evaluation_date),
    call_type=coalesce(v_call_type, call_type), observed_issue=coalesce(p_observed_issue, observed_issue),
    observed_issue_other=coalesce(p_observed_issue_other, observed_issue_other), action_taken=coalesce(p_action_taken, action_taken),
    action_taken_other=coalesce(p_action_taken_other, action_taken_other), notes=coalesce(p_notes, notes),
    communication_type=coalesce(p_communication_type, communication_type),
    communication_reference=coalesce(nullif(trim(coalesce(p_communication_reference,'')),''), communication_reference),
    items=p_items, section_scores=v_scores->'section_scores', total_score=(v_scores->>'total_score')::numeric,
    percentage=(v_scores->>'percentage')::numeric, grade=v_scores->>'grade', status=v_scores->>'status',
    pass_score_snapshot=coalesce(pass_score_snapshot, v_pass),                          -- ★ ملف 30: تجميد (يكتب فقط إن كان NULL)
    updated_at=now()
  where id = p_eval_id;

  insert into public.notifications(id, user_id, title, message, type, entity_type, entity_id, is_read, created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), coalesce(p_employee_id, v_eval.employee_id), 'تم تعديل تقييمك',
    'تم تعديل تقييمك — النتيجة '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||')',
    case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', p_eval_id, false, now());
  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'update_evaluation','evaluation',p_eval_id,'تعديل تقييم #'||p_eval_id||' — '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||') — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم تحديث التقييم'::text;
end; $function$;

COMMIT;
