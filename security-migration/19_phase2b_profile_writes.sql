-- ============================================================================
-- المرحلة 2-ب — دفعة 4: إغلاق مسارات كتابة المستخدمين المتبقّية
-- ============================================================================
-- create_employee / update_employee_profile (admin+quality_officer)
-- update_own_profile (أي مستخدم على نفسه). change_password موجودة وكافية.
-- ============================================================================

begin;

-- 1) إنشاء موظف (دور مثبّت = employee، يمنع تصعيد الصلاحيات) -------------------
create or replace function public.create_employee(
  p_session_token   text,
  p_full_name       text,
  p_email           text,
  p_employee_number text,
  p_position        text default null,
  p_department      text default null,
  p_phone           text default null,
  p_supervisor_id   bigint default null,
  p_supervisor_name text default null
) returns table(ok boolean, user_id bigint, temp_password text, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_actor text; v_temp text := ''; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; i int; v_id bigint;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::bigint,null::text,'ليس لديك صلاحية لإضافة موظف'::text; return; end if;
  if coalesce(trim(p_full_name),'')='' or coalesce(trim(p_email),'')='' or coalesce(trim(p_employee_number),'')='' then
    return query select false,null::bigint,null::text,'الاسم والبريد والرقم الوظيفي مطلوبة'::text; return; end if;
  if exists(select 1 from public.users where lower(email)=lower(p_email)) then return query select false,null::bigint,null::text,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  if exists(select 1 from public.users where lower(username)=lower(p_employee_number) or employee_number=p_employee_number) then return query select false,null::bigint,null::text,'الرقم الوظيفي مستخدم مسبقاً'::text; return; end if;

  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  v_id := (select coalesce(max(id),0)+1 from public.users);

  insert into public.users(id,username,email,password,full_name,phone,role,department,position,employee_number,supervisor_id,supervisor_name,is_active,must_change_password,created_at,updated_at)
  values(v_id,p_employee_number,p_email,v_temp,p_full_name,p_phone,'employee',coalesce(p_department,'قسم الجودة'),p_position,p_employee_number,p_supervisor_id,coalesce(p_supervisor_name,'-'),true,true,now(),now());

  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,
    'create_user','user',v_id,'إضافة موظف: '||p_full_name||' ('||p_employee_number||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true,v_id,v_temp,'تم إضافة الموظف'::text;
end; $$;
revoke all on function public.create_employee(text,text,text,text,text,text,text,bigint,text) from public;
grant execute on function public.create_employee(text,text,text,text,text,text,text,bigint,text) to anon, authenticated;

-- 2) تعديل بيانات موظف (حقول الملف فقط، لا الدور) -----------------------------
create or replace function public.update_employee_profile(
  p_session_token   text,
  p_user_id         bigint,
  p_full_name       text default null,
  p_email           text default null,
  p_employee_number text default null,
  p_position        text default null,
  p_department      text default null,
  p_phone           text default null,
  p_supervisor_id   bigint default null,
  p_supervisor_name text default null
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_actor text; v_t public.users;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,'ليس لديك صلاحية لتعديل الموظف'::text; return; end if;
  select * into v_t from public.users where id=p_user_id;
  if v_t.id is null then return query select false,'المستخدم غير موجود'::text; return; end if;
  if p_email is not null and lower(p_email)<>lower(v_t.email) and exists(select 1 from public.users where lower(email)=lower(p_email) and id<>p_user_id) then
    return query select false,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  if p_employee_number is not null and p_employee_number<>coalesce(v_t.employee_number,'') and exists(select 1 from public.users where employee_number=p_employee_number and id<>p_user_id) then
    return query select false,'الرقم الوظيفي مستخدم مسبقاً'::text; return; end if;

  update public.users set
    full_name=coalesce(p_full_name,full_name), email=coalesce(p_email,email),
    employee_number=coalesce(p_employee_number,employee_number), position=coalesce(p_position,position),
    department=coalesce(p_department,department), phone=coalesce(p_phone,phone),
    supervisor_id=coalesce(p_supervisor_id,supervisor_id), supervisor_name=coalesce(p_supervisor_name,supervisor_name),
    updated_at=now()
  where id=p_user_id;

  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,
    'update_user','user',p_user_id,'تعديل بيانات الموظف #'||p_user_id||' ('||coalesce(v_t.full_name::text,'-')||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true,'تم حفظ التعديلات'::text;
end; $$;
revoke all on function public.update_employee_profile(text,bigint,text,text,text,text,text,text,bigint,text) from public;
grant execute on function public.update_employee_profile(text,bigint,text,text,text,text,text,text,bigint,text) to anon, authenticated;

-- 3) تعديل المستخدم بياناته الشخصية (اسم/بريد/هاتف) --------------------------
create or replace function public.update_own_profile(
  p_session_token text, p_full_name text default null, p_email text default null, p_phone text default null
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare v_sess record; v_t public.users;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  select * into v_t from public.users where id=v_sess.user_id;
  if v_t.id is null then return query select false,'المستخدم غير موجود'::text; return; end if;
  if p_email is not null and lower(p_email)<>lower(v_t.email) and exists(select 1 from public.users where lower(email)=lower(p_email) and id<>v_sess.user_id) then
    return query select false,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;

  update public.users set full_name=coalesce(p_full_name,full_name), email=coalesce(p_email,email), phone=coalesce(p_phone,phone), updated_at=now()
  where id=v_sess.user_id;

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(p_full_name,v_t.full_name::text),v_sess.role,
    'update_profile','user',v_sess.user_id,'تحديث الملف الشخصي',now());

  return query select true,'تم حفظ التعديلات'::text;
end; $$;
revoke all on function public.update_own_profile(text,text,text,text) from public;
grant execute on function public.update_own_profile(text,text,text,text) to anon, authenticated;

commit;
