-- ============================================================================
-- المرحلة 2-ب — دفعة 1: كتابات التقييم عبر RPCs مُصادَقة
-- ============================================================================
-- create_evaluation / record_supervisor_action / approve_evaluation
-- كلها: رمز إلزامي + تحقّق دور، الهوية/التدقيق من الجلسة، create يعيد الاحتساب.
-- ============================================================================

begin;

-- 1) إنشاء تقييم --------------------------------------------------------------
create or replace function public.create_evaluation(
  p_session_token        text,
  p_employee_id          bigint,
  p_evaluation_date      date,
  p_observed_issue       text default null,
  p_observed_issue_other text default null,
  p_action_taken         text default null,
  p_action_taken_other   text default null,
  p_notes                text default null,
  p_items                jsonb default '{}'::jsonb
) returns table(ok boolean, evaluation_id bigint, percentage numeric, grade text, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess record; v_actor text; v_emp text; v_scores jsonb; v_id bigint; v_call text;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, null::bigint, null::numeric, null::text, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false, null::bigint, null::numeric, null::text, 'ليس لديك صلاحية لإنشاء تقييم'::text; return; end if;
  if p_employee_id is null or p_evaluation_date is null then return query select false, null::bigint, null::numeric, null::text, 'الموظف والتاريخ مطلوبان'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then p_items := '{}'::jsonb; end if;

  v_scores := public.compute_evaluation_scores(p_items);
  if v_scores ? 'error' then return query select false, null::bigint, null::numeric, null::text, 'تعذّر احتساب الدرجة'::text; return; end if;

  v_id := (select coalesce(max(id),0)+1 from public.evaluations);
  v_call := case when p_observed_issue = 'أخرى' then coalesce(p_observed_issue_other, p_observed_issue) else p_observed_issue end;

  insert into public.evaluations(id, employee_id, evaluator_id, evaluation_date, call_type,
    observed_issue, observed_issue_other, action_taken, action_taken_other,
    supervisor_action, supervisor_action_other, supervisor_notes, supervisor_action_by, supervisor_action_by_name, supervisor_action_at,
    notes, items, section_scores, total_score, percentage, grade, status, approved, created_at, updated_at)
  values(v_id, p_employee_id, v_sess.user_id, p_evaluation_date, coalesce(v_call,''),
    coalesce(p_observed_issue,''), coalesce(p_observed_issue_other,''), coalesce(p_action_taken,''), coalesce(p_action_taken_other,''),
    '', '', '', null, '', null,
    coalesce(p_notes,''), p_items, v_scores->'section_scores', (v_scores->>'total_score')::numeric, (v_scores->>'percentage')::numeric, v_scores->>'grade', v_scores->>'status', false, now(), now());

  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), p_employee_id, 'تم استلام تقييم جديد',
    'تم تقييمك بنسبة '||(v_scores->>'percentage')||'% - '||(v_scores->>'grade'),
    case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', v_id, false, now());

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  select full_name::text into v_emp from public.users where id = p_employee_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'create_evaluation','evaluation',v_id,'إنشاء تقييم #'||v_id||' للموظف '||coalesce(v_emp,'-')||' - '||(v_scores->>'percentage')||'% — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, v_id, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم إنشاء التقييم'::text;
end; $$;
revoke all on function public.create_evaluation(text,bigint,date,text,text,text,text,text,jsonb) from public;
grant execute on function public.create_evaluation(text,bigint,date,text,text,text,text,text,jsonb) to anon, authenticated;

-- 2) إجراء المشرف ------------------------------------------------------------
create or replace function public.record_supervisor_action(
  p_session_token text, p_eval_id bigint, p_action text, p_action_other text default null, p_notes text default null
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_actor text; v_eval public.evaluations;
  v_allowed constant text[] := array['admin','quality_officer','supervisor'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,'ليس لديك صلاحية لتسجيل إجراء'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then return query select false,'التقييم غير موجود'::text; return; end if;
  if coalesce(trim(p_action),'')='' then return query select false,'الإجراء مطلوب'::text; return; end if;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  update public.evaluations set
    supervisor_action = p_action, supervisor_action_other = coalesce(p_action_other,''),
    supervisor_notes = coalesce(p_notes,''), supervisor_action_by = v_sess.user_id,
    supervisor_action_by_name = coalesce(v_actor,''), supervisor_action_at = now(), updated_at = now()
  where id = p_eval_id;

  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), v_eval.employee_id, 'تم تسجيل إجراء على تقييمك',
    'قام المشرف باتخاذ إجراء: '||p_action, 'info', 'evaluation', p_eval_id, false, now());

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'supervisor_action','evaluation',p_eval_id,'تسجيل إجراء المشرف على تقييم #'||p_eval_id||': '||p_action||' — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true,'تم تسجيل إجراء المشرف'::text;
end; $$;
revoke all on function public.record_supervisor_action(text,bigint,text,text,text) from public;
grant execute on function public.record_supervisor_action(text,bigint,text,text,text) to anon, authenticated;

-- 3) اعتماد التقييم ----------------------------------------------------------
create or replace function public.approve_evaluation(
  p_session_token text, p_eval_id bigint
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_actor text; v_eval public.evaluations;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,'ليس لديك صلاحية لاعتماد التقييم'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then return query select false,'التقييم غير موجود'::text; return; end if;
  if coalesce(trim(v_eval.action_taken),'')='' then return query select false,'لا يمكن اعتماد التقييم بدون تحديد "الإجراء المتخذ"'::text; return; end if;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  update public.evaluations set approved = true, approved_at = now(), approved_by = v_sess.user_id, updated_at = now() where id = p_eval_id;

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'approve_evaluation','evaluation',p_eval_id,'اعتماد تقييم #'||p_eval_id||' — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true,'تم اعتماد التقييم'::text;
end; $$;
revoke all on function public.approve_evaluation(text,bigint) from public;
grant execute on function public.approve_evaluation(text,bigint) to anon, authenticated;

commit;
