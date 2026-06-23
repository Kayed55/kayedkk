-- ============================================================================
-- تعديل create_evaluation و admin_update_evaluation لدعم حقول نوع التواصل
-- ============================================================================
-- إضافة معاملين: p_communication_type ('chat'|'call') + p_communication_reference.
-- نُسقط النسخة القديمة أولاً (تغيّر التوقيع → تفادي overload) ثم نُعيد المنح.
-- ============================================================================
begin;

drop function if exists public.create_evaluation(text,bigint,date,text,text,text,text,text,jsonb);
create or replace function public.create_evaluation(
  p_session_token text, p_employee_id bigint, p_evaluation_date date,
  p_observed_issue text default null, p_observed_issue_other text default null,
  p_action_taken text default null, p_action_taken_other text default null,
  p_notes text default null, p_items jsonb default '{}'::jsonb,
  p_communication_type text default null, p_communication_reference text default null
) returns table(ok boolean, evaluation_id bigint, percentage numeric, grade text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_sess record; v_actor text; v_emp text; v_scores jsonb; v_id bigint; v_call text;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::numeric,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::bigint,null::numeric,null::text,'ليس لديك صلاحية لإنشاء تقييم'::text; return; end if;
  if p_employee_id is null or p_evaluation_date is null then return query select false,null::bigint,null::numeric,null::text,'الموظف والتاريخ مطلوبان'::text; return; end if;
  if p_communication_type is null or p_communication_type not in ('chat','call') then return query select false,null::bigint,null::numeric,null::text,'نوع التواصل مطلوب (محادثة/اتصال)'::text; return; end if;
  if coalesce(trim(p_communication_reference),'') = '' then return query select false,null::bigint,null::numeric,null::text,'مرجع التواصل (الرابط/الكود) مطلوب'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then p_items := '{}'::jsonb; end if;

  v_scores := public.compute_evaluation_scores(p_items);
  if v_scores ? 'error' then return query select false,null::bigint,null::numeric,null::text,'تعذّر احتساب الدرجة'::text; return; end if;

  v_id := (select coalesce(max(id),0)+1 from public.evaluations);
  v_call := case when p_observed_issue = 'أخرى' then coalesce(p_observed_issue_other, p_observed_issue) else p_observed_issue end;

  insert into public.evaluations(id, employee_id, evaluator_id, evaluation_date, call_type,
    observed_issue, observed_issue_other, action_taken, action_taken_other,
    supervisor_action, supervisor_action_other, supervisor_notes, supervisor_action_by, supervisor_action_by_name, supervisor_action_at,
    notes, items, section_scores, total_score, percentage, grade, status, approved,
    communication_type, communication_reference, created_at, updated_at)
  values(v_id, p_employee_id, v_sess.user_id, p_evaluation_date, coalesce(v_call,''),
    coalesce(p_observed_issue,''), coalesce(p_observed_issue_other,''), coalesce(p_action_taken,''), coalesce(p_action_taken_other,''),
    '', '', '', null, '', null,
    coalesce(p_notes,''), p_items, v_scores->'section_scores', (v_scores->>'total_score')::numeric, (v_scores->>'percentage')::numeric, v_scores->>'grade', v_scores->>'status', false,
    p_communication_type, trim(p_communication_reference), now(), now());

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
end; $function$;
revoke all on function public.create_evaluation(text,bigint,date,text,text,text,text,text,jsonb,text,text) from public;
grant execute on function public.create_evaluation(text,bigint,date,text,text,text,text,text,jsonb,text,text) to anon, authenticated;

drop function if exists public.admin_update_evaluation(text,bigint,bigint,date,text,text,text,text,text,jsonb);
create or replace function public.admin_update_evaluation(
  p_session_token text, p_eval_id bigint, p_employee_id bigint default null, p_evaluation_date date default null,
  p_observed_issue text default null, p_observed_issue_other text default null,
  p_action_taken text default null, p_action_taken_other text default null,
  p_notes text default null, p_items jsonb default null,
  p_communication_type text default null, p_communication_reference text default null
) returns table(ok boolean, percentage numeric, grade text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_sess record; v_actor text; v_eval public.evaluations; v_scores jsonb; v_call_type text;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::numeric,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::numeric,null::text,'ليس لديك صلاحية لتعديل التقييمات'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then return query select false,null::numeric,null::text,'التقييم غير موجود'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then return query select false,null::numeric,null::text,'بيانات البنود غير صالحة'::text; return; end if;
  if p_communication_type is not null and p_communication_type not in ('chat','call') then return query select false,null::numeric,null::text,'نوع التواصل غير صالح'::text; return; end if;

  v_scores := public.compute_evaluation_scores(p_items);
  if v_scores ? 'error' then return query select false,null::numeric,null::text,'تعذّر احتساب الدرجة (معايير غير متوفّرة)'::text; return; end if;

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
    communication_type   = coalesce(p_communication_type, communication_type),
    communication_reference = coalesce(nullif(trim(coalesce(p_communication_reference,'')),''), communication_reference),
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
    case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', p_eval_id, false, now());

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'update_evaluation','evaluation',p_eval_id,'تعديل تقييم #'||p_eval_id||' — النتيجة '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم تحديث التقييم'::text;
end; $function$;
revoke all on function public.admin_update_evaluation(text,bigint,bigint,date,text,text,text,text,text,jsonb,text,text) from public;
grant execute on function public.admin_update_evaluation(text,bigint,bigint,date,text,text,text,text,text,jsonb,text,text) to anon, authenticated;

commit;
