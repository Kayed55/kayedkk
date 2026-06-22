-- ============================================================================
-- المرحلة 2-ب — دفعة 2: كتابات الاعتراضات عبر RPCs مُصادَقة
-- ============================================================================
-- create_objection: الموظف يعترض على تقييمه فقط (الهوية من الجلسة).
-- add_objection_comment: المراجعون (admin/quality_officer/supervisor) أو صاحب الاعتراض.
-- ============================================================================

begin;

create or replace function public.create_objection(
  p_session_token text,
  p_evaluation_id bigint,
  p_reason        text,
  p_attachments   jsonb default '[]'::jsonb
) returns table(ok boolean, objection_id bigint, ref_number text, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_eval public.evaluations; v_id bigint; v_ref text;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, null::bigint, null::text, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role <> 'employee' then return query select false, null::bigint, null::text, 'تقديم الاعتراض متاح للموظف فقط'::text; return; end if;
  if coalesce(trim(p_reason),'')='' then return query select false, null::bigint, null::text, 'سبب الاعتراض مطلوب'::text; return; end if;

  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if v_eval.id is null then return query select false, null::bigint, null::text, 'التقييم غير موجود'::text; return; end if;
  if v_eval.employee_id <> v_sess.user_id then return query select false, null::bigint, null::text, 'لا يمكنك الاعتراض على تقييم ليس لك'::text; return; end if;
  if exists(select 1 from public.objections where evaluation_id = p_evaluation_id and employee_id = v_sess.user_id and status = 'pending') then
    return query select false, null::bigint, null::text, 'لديك اعتراض قائم على هذا التقييم'::text; return;
  end if;

  v_id := (select coalesce(max(id),0)+1 from public.objections);
  v_ref := 'OBJ-'||to_char(now(),'YYYY')||'-'||lpad(v_id::text,4,'0');

  insert into public.objections(id, ref_number, evaluation_id, employee_id, reason, attachments, status, comments, created_at, updated_at)
  values(v_id, v_ref, p_evaluation_id, v_sess.user_id, p_reason, coalesce(p_attachments,'[]'::jsonb), 'pending', '[]'::jsonb, now(), now());

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, (select full_name::text from public.users where id=v_sess.user_id), v_sess.role,
    'submit_objection','objection',v_id,'تقديم اعتراض '||v_ref||' على التقييم #'||p_evaluation_id,now());

  return query select true, v_id, v_ref, 'تم تقديم الاعتراض'::text;
end; $$;
revoke all on function public.create_objection(text,bigint,text,jsonb) from public;
grant execute on function public.create_objection(text,bigint,text,jsonb) to anon, authenticated;

create or replace function public.add_objection_comment(
  p_session_token text, p_objection_id bigint, p_text text
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_actor text; v_obj public.objections;
  v_reviewer constant text[] := array['admin','quality_officer','supervisor'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if coalesce(trim(p_text),'')='' then return query select false,'نص التعليق مطلوب'::text; return; end if;
  select * into v_obj from public.objections where id = p_objection_id;
  if v_obj.id is null then return query select false,'الاعتراض غير موجود'::text; return; end if;
  -- مراجع، أو صاحب الاعتراض نفسه
  if not (v_sess.role = any(v_reviewer) or v_obj.employee_id = v_sess.user_id) then
    return query select false,'ليس لديك صلاحية للتعليق على هذا الاعتراض'::text; return;
  end if;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  update public.objections set
    comments = coalesce(comments,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'user_id', v_sess.user_id, 'user_name', coalesce(v_actor,'-'), 'role', v_sess.role,
      'text', p_text, 'created_at', now())),
    updated_at = now()
  where id = p_objection_id;

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'comment_objection','objection',p_objection_id,'تعليق على الاعتراض '||coalesce(v_obj.ref_number,'#'||p_objection_id)||' — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true,'تمت إضافة التعليق'::text;
end; $$;
revoke all on function public.add_objection_comment(text,bigint,text) from public;
grant execute on function public.add_objection_comment(text,bigint,text) to anon, authenticated;

commit;
