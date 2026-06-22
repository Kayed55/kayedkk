-- ============================================================================
-- المرحلة 2-ب — دفعة 3: إشعارات + تحويل اعتراض لقيد المراجعة + log_event
-- ============================================================================

begin;

-- 1) تعليم إشعارات المستخدم نفسه مقروءة -------------------------------------
create or replace function public.mark_notifications_read(
  p_session_token text
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  update public.notifications set is_read = true where user_id = v_sess.user_id and is_read = false;
  return query select true,'تم'::text;
end; $$;
revoke all on function public.mark_notifications_read(text) from public;
grant execute on function public.mark_notifications_read(text) to anon, authenticated;

-- 2) تحويل اعتراض إلى "قيد المراجعة" ----------------------------------------
create or replace function public.mark_objection_under_review(
  p_session_token text, p_objection_id bigint
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_actor text; v_obj public.objections;
  v_allowed constant text[] := array['admin','quality_officer','supervisor'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,'ليس لديك صلاحية'::text; return; end if;
  select * into v_obj from public.objections where id = p_objection_id;
  if v_obj.id is null then return query select false,'الاعتراض غير موجود'::text; return; end if;
  if v_obj.status in ('accepted','rejected') then return query select false,'تم البتّ في هذا الاعتراض مسبقاً'::text; return; end if;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  update public.objections set status='under_review', reviewed_at=now(), reviewed_by=v_sess.user_id, updated_at=now() where id=p_objection_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'review_objection','objection',p_objection_id,'تحويل الاعتراض '||coalesce(v_obj.ref_number,'#'||p_objection_id)||' إلى قيد المراجعة — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true,'تم تحويل الاعتراض إلى قيد المراجعة'::text;
end; $$;
revoke all on function public.mark_objection_under_review(text,bigint) from public;
grant execute on function public.mark_objection_under_review(text,bigint) to anon, authenticated;

-- 3) تسجيل أحداث العميل (بديل addAudit بعد سحب anon) ------------------------
-- session اختياري (failed_login/failed_otp قد تكون بلا جلسة صالحة).
-- allowlist لمنع حقن أحداث تدقيق عشوائية.
create or replace function public.log_event(
  p_session_token text,
  p_action        text,
  p_entity_type   text default 'login',
  p_entity_id     bigint default null,
  p_details       text default null
) returns table(ok boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess record; v_uid bigint; v_name text; v_role text; v_ip text;
  v_allowed constant text[] := array['failed_login','failed_otp','login','password_reset_request','client_error','change_supervisor'];
begin
  if p_action is null or not (p_action = any(v_allowed)) then return query select false; return; end if;
  begin v_ip := (current_setting('request.headers', true)::json ->> 'x-forwarded-for'); exception when others then v_ip := null; end;

  select * into v_sess from public.verify_session(p_session_token);
  if coalesce(v_sess.is_valid,false) then
    v_uid := v_sess.user_id; v_role := v_sess.role;
    select full_name::text into v_name from public.users where id = v_sess.user_id;
  else
    v_uid := null; v_name := 'زائر'; v_role := '-';
  end if;

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,ip_address,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_uid, coalesce(v_name,'زائر'), coalesce(v_role,'-'),
    p_action, coalesce(p_entity_type,'login'), p_entity_id, left(coalesce(p_details,''),500), v_ip, now());
  return query select true;
end; $$;
revoke all on function public.log_event(text,text,text,bigint,text) from public;
grant execute on function public.log_event(text,text,text,bigint,text) to anon, authenticated;

commit;
