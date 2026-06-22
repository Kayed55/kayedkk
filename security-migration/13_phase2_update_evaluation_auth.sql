-- ============================================================================
-- المرحلة 2 (أمان) — تعديل التقييم: إعادة احتساب الدرجة على الخادم
-- ============================================================================
-- compute_evaluation_scores(items): نقل calculateScores إلى SQL — العميل لا
--   يستطيع تزوير الدرجة/الحالة. admin_update_evaluation: تعديل مُصادَق يعيد
--   الاحتساب داخلياً ويتجاهل أي درجات من العميل.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- دالة الاحتساب (منقولة حرفياً من calculateScores)
-- ----------------------------------------------------------------------------
create or replace function public.compute_evaluation_scores(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crit     jsonb;
  v_ok text; v_err text; v_na text;
  v_section jsonb; v_sub jsonb; v_item jsonb;
  v_total numeric := 0; v_sscore numeric; v_sstotal numeric;
  v_applicable int; v_correct int; v_haserror boolean; v_ans text;
  v_scores jsonb := '{}'::jsonb; v_pct numeric; v_grade text;
begin
  select config_value into v_crit from public.criteria_config where config_key = 'criteria' limit 1;
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
        if v_applicable > 0 then
          v_sstotal := v_sstotal + (v_correct::numeric / v_applicable) * (v_sub->>'weight')::numeric;
        else
          v_sstotal := v_sstotal + (v_sub->>'weight')::numeric;
        end if;
      end loop;
      v_sscore := round(v_sstotal * 10) / 10;
    end if;
    v_scores := v_scores || jsonb_build_object(v_section->>'key', v_sscore);
    v_total := v_total + v_sscore;
  end loop;

  v_total := round(v_total * 10) / 10;
  v_pct := v_total;
  v_grade := case when v_pct >= 85 then 'ناجح' else 'راسب' end;
  return jsonb_build_object('section_scores', v_scores, 'total_score', v_total,
                            'percentage', v_pct, 'grade', v_grade, 'status', v_grade);
end; $$;

revoke all on function public.compute_evaluation_scores(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- تعديل التقييم (مُصادَق، إعادة احتساب على الخادم)
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_evaluation(
  p_session_token        text,
  p_eval_id              bigint,
  p_employee_id          bigint default null,
  p_evaluation_date      date   default null,
  p_observed_issue       text   default null,
  p_observed_issue_other text   default null,
  p_action_taken         text   default null,
  p_action_taken_other   text   default null,
  p_notes                text   default null,
  p_items                jsonb  default null
) returns table(ok boolean, percentage numeric, grade text, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess record; v_actor text; v_eval public.evaluations;
  v_scores jsonb; v_call_type text;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, null::numeric, null::text, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false, null::numeric, null::text, 'ليس لديك صلاحية لتعديل التقييمات'::text; return; end if;

  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then return query select false, null::numeric, null::text, 'التقييم غير موجود'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then return query select false, null::numeric, null::text, 'بيانات البنود غير صالحة'::text; return; end if;

  v_scores := public.compute_evaluation_scores(p_items);
  if v_scores ? 'error' then return query select false, null::numeric, null::text, 'تعذّر احتساب الدرجة (معايير غير متوفّرة)'::text; return; end if;

  v_call_type := case when p_observed_issue = 'أخرى' then coalesce(p_observed_issue_other, p_observed_issue) else p_observed_issue end;

  update public.evaluations set
    employee_id          = coalesce(p_employee_id, employee_id),
    evaluation_date      = coalesce(p_evaluation_date, evaluation_date),
    call_type            = coalesce(v_call_type, call_type),
    observed_issue       = coalesce(p_observed_issue, observed_issue),
    observed_issue_other = coalesce(p_observed_issue_other, observed_issue_other),
    action_taken         = coalesce(p_action_taken, action_taken),
    action_taken_other   = coalesce(p_action_taken_other, action_taken_other),
    notes                = coalesce(p_notes, notes),
    items                = p_items,
    section_scores       = v_scores->'section_scores',
    total_score          = (v_scores->>'total_score')::numeric,
    percentage           = (v_scores->>'percentage')::numeric,
    grade                = v_scores->>'grade',
    status               = v_scores->>'status',
    updated_at           = now()
  where id = p_eval_id;

  insert into public.notifications(id, user_id, title, message, type, entity_type, entity_id, is_read, created_at)
  values((select coalesce(max(id),0)+1 from public.notifications),
    coalesce(p_employee_id, v_eval.employee_id), 'تم تعديل تقييمك',
    'تم تعديل تقييمك — النتيجة '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||')',
    case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end,
    'evaluation', p_eval_id, false, now());

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'update_evaluation','evaluation',p_eval_id,
    'تعديل تقييم #'||p_eval_id||' — النتيجة المعاد احتسابها '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم تحديث التقييم'::text;
end; $$;

revoke all on function public.admin_update_evaluation(text,bigint,bigint,date,text,text,text,text,text,jsonb) from public;
grant execute on function public.admin_update_evaluation(text,bigint,bigint,date,text,text,text,text,text,jsonb) to anon, authenticated;

commit;
