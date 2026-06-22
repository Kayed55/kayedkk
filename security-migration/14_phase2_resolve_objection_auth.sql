-- ============================================================================
-- المرحلة 2 (أمان) — حسم الاعتراضات عبر RPC مُصادَق
-- ============================================================================
-- admin_resolve_objection: قبول/رفض اعتراض بهوية الجلسة، منع إعادة الحسم،
--   إلحاق تعليق الحسم بهوية الجلسة، إشعار الموظف، تدقيق.
-- ============================================================================

begin;

create or replace function public.admin_resolve_objection(
  p_session_token text,
  p_objection_id  bigint,
  p_decision      text,
  p_response      text default null
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess record; v_actor text; v_obj public.objections;
  v_allowed constant text[] := array['admin','quality_officer'];
  v_comment jsonb;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false, 'ليس لديك صلاحية للبتّ في الاعتراضات'::text; return; end if;
  if p_decision is null or p_decision not in ('accepted','rejected') then return query select false, 'قرار غير صالح'::text; return; end if;

  select * into v_obj from public.objections where id = p_objection_id;
  if v_obj.id is null then return query select false, 'الاعتراض غير موجود'::text; return; end if;
  if v_obj.status in ('accepted','rejected') then return query select false, 'تم البتّ في هذا الاعتراض مسبقاً'::text; return; end if;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;

  if p_response is not null and trim(p_response) <> '' then
    v_comment := jsonb_build_object(
      'user_id', v_sess.user_id, 'user_name', coalesce(v_actor,'-'), 'role', v_sess.role,
      'text', p_response, 'created_at', now(), 'is_resolution', true);
  end if;

  update public.objections set
    status      = p_decision,
    decision    = p_decision,
    resolved_at = now(),
    resolved_by = v_sess.user_id,
    comments    = case when v_comment is not null then coalesce(comments,'[]'::jsonb) || jsonb_build_array(v_comment) else comments end,
    updated_at  = now()
  where id = p_objection_id;

  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), v_obj.employee_id, 'تم الرد على اعتراضك',
    'الاعتراض '||v_obj.ref_number||': '||case when p_decision='accepted' then 'تم قبوله' else 'تم رفضه' end,
    case when p_decision='accepted' then 'success' else 'warning' end, 'objection', p_objection_id, false, now());

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'resolve_objection','objection',p_objection_id,
    'البتّ في الاعتراض '||v_obj.ref_number||' — '||case when p_decision='accepted' then 'مقبول' else 'مرفوض' end||' — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, case when p_decision='accepted' then 'تم قبول الاعتراض' else 'تم رفض الاعتراض' end::text;
end; $$;

revoke all on function public.admin_resolve_objection(text,bigint,text,text) from public;
grant execute on function public.admin_resolve_objection(text,bigint,text,text) to anon, authenticated;

commit;
