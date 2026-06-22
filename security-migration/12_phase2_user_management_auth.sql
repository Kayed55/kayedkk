-- ============================================================================
-- المرحلة 2 (أمان) — إدارة المستخدمين عبر RPCs مُصادَقة (admin فقط)
-- ============================================================================
-- 3 دوال: admin_create_user / admin_update_user / admin_set_user_active
-- جميعها: رمز جلسة إلزامي + دور admin؛ الهوية من السيرفر؛ تدقيق بالهوية الحقيقية.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) إنشاء مستخدم
-- ----------------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_session_token   text,
  p_full_name       text,
  p_email           text,
  p_username        text,
  p_role            text,
  p_department      text   default null,
  p_position        text   default null,
  p_phone           text   default null,
  p_employee_number text   default null,
  p_supervisor_id   bigint default null,
  p_hire_date       date   default null,
  p_notes           text   default null
) returns table(ok boolean, user_id bigint, temp_password text, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess    record;
  v_actor   text;
  v_allowed constant text[] := array['admin','quality_officer','supervisor','employee'];
  v_temp    text := '';
  v_chars   constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  i int; v_id bigint;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then
    return query select false, null::bigint, null::text, 'انتهت الجلسة أو الرمز غير صالح'::text; return;
  end if;
  if v_sess.role <> 'admin' then
    return query select false, null::bigint, null::text, 'هذه العملية للمدير فقط'::text; return;
  end if;
  if coalesce(trim(p_full_name),'')='' or coalesce(trim(p_email),'')='' or coalesce(trim(p_username),'')='' then
    return query select false, null::bigint, null::text, 'الاسم والبريد واسم المستخدم مطلوبة'::text; return;
  end if;
  if not (p_role = any(v_allowed)) then
    return query select false, null::bigint, null::text, 'دور غير صالح'::text; return;
  end if;
  if exists(select 1 from public.users where lower(email)=lower(p_email)) then
    return query select false, null::bigint, null::text, 'البريد الإلكتروني مستخدم مسبقاً'::text; return;
  end if;
  if exists(select 1 from public.users where lower(username)=lower(p_username)) then
    return query select false, null::bigint, null::text, 'اسم المستخدم مستخدم مسبقاً'::text; return;
  end if;

  for i in 1..10 loop v_temp := v_temp || substr(v_chars, 1+floor(random()*length(v_chars))::int, 1); end loop;
  v_id := (select coalesce(max(id),0)+1 from public.users);

  insert into public.users(id, username, email, password, full_name, phone, role, department, position,
                           employee_number, supervisor_id, is_active, must_change_password, hire_date, notes,
                           created_at, updated_at)
  values (v_id, p_username, p_email, v_temp, p_full_name, p_phone, p_role, p_department, p_position,
          p_employee_number, p_supervisor_id, true, true, p_hire_date, p_notes, now(), now());

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
         'create_user','user',v_id,'إنشاء مستخدم: '||p_full_name||' ('||p_role||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, v_id, v_temp, 'تم إنشاء المستخدم'::text;
end; $$;
revoke all on function public.admin_create_user(text,text,text,text,text,text,text,text,text,bigint,date,text) from public;
grant execute on function public.admin_create_user(text,text,text,text,text,text,text,text,text,bigint,date,text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) تعديل مستخدم (COALESCE: تُحدَّث الحقول غير null فقط)
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_user(
  p_session_token   text,
  p_user_id         bigint,
  p_full_name       text   default null,
  p_email           text   default null,
  p_role            text   default null,
  p_department      text   default null,
  p_position        text   default null,
  p_phone           text   default null,
  p_employee_number text   default null,
  p_supervisor_id   bigint default null,
  p_hire_date       date   default null,
  p_notes           text   default null
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess record; v_actor text; v_target public.users;
  v_allowed constant text[] := array['admin','quality_officer','supervisor','employee'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role <> 'admin' then return query select false, 'هذه العملية للمدير فقط'::text; return; end if;

  select * into v_target from public.users where id = p_user_id;
  if v_target.id is null then return query select false, 'المستخدم غير موجود'::text; return; end if;

  -- تغيير الدور
  if p_role is not null and p_role <> v_target.role then
    if p_user_id = v_sess.user_id then return query select false, 'لا يمكنك تغيير دور حسابك'::text; return; end if;
    if not (p_role = any(v_allowed)) then return query select false, 'دور غير صالح'::text; return; end if;
  end if;
  -- تفرّد البريد عند تغييره
  if p_email is not null and lower(p_email) <> lower(v_target.email)
     and exists(select 1 from public.users where lower(email)=lower(p_email) and id<>p_user_id) then
    return query select false, 'البريد الإلكتروني مستخدم مسبقاً'::text; return;
  end if;

  update public.users set
    full_name       = coalesce(p_full_name, full_name),
    email           = coalesce(p_email, email),
    role            = coalesce(p_role, role),
    department      = coalesce(p_department, department),
    position        = coalesce(p_position, position),
    phone           = coalesce(p_phone, phone),
    employee_number = coalesce(p_employee_number, employee_number),
    supervisor_id   = coalesce(p_supervisor_id, supervisor_id),
    hire_date       = coalesce(p_hire_date, hire_date),
    notes           = coalesce(p_notes, notes),
    updated_at      = now()
  where id = p_user_id;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
         'update_user','user',p_user_id,'تعديل بيانات المستخدم #'||p_user_id||' ('||coalesce(v_target.full_name::text,'-')||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, 'تم تحديث بيانات المستخدم'::text;
end; $$;
revoke all on function public.admin_update_user(text,bigint,text,text,text,text,text,text,text,bigint,date,text) from public;
grant execute on function public.admin_update_user(text,bigint,text,text,text,text,text,text,text,bigint,date,text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) تفعيل/تعطيل مستخدم (التعطيل = حذف ناعم)
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_user_active(
  p_session_token text,
  p_user_id       bigint,
  p_active        boolean
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess record; v_actor text; v_target public.users; v_active_admins int;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role <> 'admin' then return query select false, 'هذه العملية للمدير فقط'::text; return; end if;

  select * into v_target from public.users where id = p_user_id;
  if v_target.id is null then return query select false, 'المستخدم غير موجود'::text; return; end if;

  if p_active = false then
    if p_user_id = v_sess.user_id then return query select false, 'لا يمكنك تعطيل حسابك'::text; return; end if;
    if v_target.role = 'admin' and coalesce(v_target.is_active,false) then
      select count(*) into v_active_admins from public.users where role='admin' and is_active = true;
      if v_active_admins <= 1 then return query select false, 'لا يمكن تعطيل آخر مدير نشط'::text; return; end if;
    end if;
  end if;

  update public.users set is_active = p_active, updated_at = now() where id = p_user_id;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
         case when p_active then 'activate_user' else 'deactivate_user' end,'user',p_user_id,
         case when p_active then 'تفعيل' else 'تعطيل' end||' المستخدم #'||p_user_id||' ('||coalesce(v_target.full_name::text,'-')||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, case when p_active then 'تم تفعيل المستخدم' else 'تم تعطيل المستخدم' end::text;
end; $$;
revoke all on function public.admin_set_user_active(text,bigint,boolean) from public;
grant execute on function public.admin_set_user_active(text,bigint,boolean) to anon, authenticated;

commit;
