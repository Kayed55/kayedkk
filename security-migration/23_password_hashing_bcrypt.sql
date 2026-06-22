-- ============================================================================
-- تجزئة كلمات المرور (bcrypt عبر pgcrypto) — هجرة ذرّية
-- ============================================================================
-- 1) استبدال دوال المقارنة لتستخدم extensions.crypt() بدل المساواة النصّية.
-- 2) استبدال دوال الضبط لتخزّن extensions.crypt(pw, gen_salt('bf',10)).
-- 3) تجزئة جماعية لكلمات المرور النصّية الموجودة (دفعة واحدة).
-- pgcrypto في schema extensions → كل النداءات مؤهّلة بـ extensions.
-- للتراجع: استعادة عمود password من النسخة الاحتياطية + إرجاع الدوال للنسخ النصّية.
-- ============================================================================

begin;

-- (1) verify_login — مقارنة bcrypt
create or replace function public.verify_login(p_email text, p_password text)
returns setof users_public language plpgsql security definer set search_path to 'public'
as $function$
begin
  return query
    select up.* from public.users u
    join public.users_public up on up.id = u.id
    where u.email = p_email
      and u.password = extensions.crypt(p_password, u.password)
      and u.is_active = true
    limit 1;
end;
$function$;

-- (2) request_login_code — مقارنة bcrypt ثم توليد OTP (بقية المنطق كما هو)
create or replace function public.request_login_code(p_email text, p_password text)
returns table(ok boolean, user_id bigint, user_email text, user_name text, masked_email text, code_to_send text, expires_at timestamp with time zone, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_user public.users; v_code text; v_expires timestamptz; v_normalized text;
begin
  v_normalized := lower(trim(coalesce(p_email, '')));
  if v_normalized = '' or coalesce(p_password,'') = '' then
    return query select false,null::bigint,null::text,null::text,null::text,null::text,null::timestamptz,'البريد وكلمة المرور مطلوبان'::text; return;
  end if;
  select * into v_user from public.users where lower(email)=v_normalized and is_active=true limit 1;
  if v_user.id is null then
    return query select false,null::bigint,null::text,null::text,null::text,null::text,null::timestamptz,'بيانات الدخول غير صحيحة'::text; return;
  end if;
  if v_user.password is null or v_user.password = '' or extensions.crypt(p_password, v_user.password) <> v_user.password then
    return query select false,null::bigint,null::text,null::text,null::text,null::text,null::timestamptz,'بيانات الدخول غير صحيحة'::text; return;
  end if;
  if v_user.email is null or trim(v_user.email) = '' then
    return query select false,null::bigint,null::text,null::text,null::text,null::text,null::timestamptz,'لا يوجد بريد إلكتروني مسجّل لهذا الحساب - تواصل مع الإدارة'::text; return;
  end if;
  update public.login_codes set used=true where public.login_codes.user_id=v_user.id and used=false;
  v_code := lpad(floor(random()*1000000)::int::text, 6, '0');
  v_expires := now() + interval '5 minutes';
  insert into public.login_codes(user_id, code, expires_at) values (v_user.id, v_code, v_expires);
  return query select true, v_user.id, v_user.email::text, v_user.full_name::text,
    (case when position('@' in v_user.email)>3 then substr(v_user.email,1,2)||'***'||substr(v_user.email,position('@' in v_user.email)) else v_user.email end)::text,
    v_code, v_expires, 'تم إرسال كود الدخول إلى بريدك'::text;
end;
$function$;

-- (3) change_password — تحقّق القديمة bcrypt + تخزين الجديدة مجزّأة
create or replace function public.change_password(p_user_id integer, p_old_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_match boolean;
begin
  select exists(select 1 from public.users where id=p_user_id and password = extensions.crypt(p_old_password, password)) into v_match;
  if not v_match then return false; end if;
  update public.users
     set password = extensions.crypt(p_new_password, extensions.gen_salt('bf',10)),
         must_change_password = false, password_changed_at = now(), updated_at = now()
   where id = p_user_id;
  return true;
end;
$function$;

-- (4) admin_create_user — كلمة بداية مجزّأة (تُعرض مرّة كنصّ)
create or replace function public.admin_create_user(p_session_token text, p_full_name text, p_email text, p_username text, p_role text, p_department text default null, p_position text default null, p_phone text default null, p_employee_number text default null, p_supervisor_id bigint default null, p_hire_date date default null, p_notes text default null)
returns table(ok boolean, user_id bigint, temp_password text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_sess record; v_actor text; v_allowed constant text[] := array['admin','quality_officer','supervisor','employee'];
  v_temp text := ''; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; i int; v_id bigint;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role <> 'admin' then return query select false,null::bigint,null::text,'هذه العملية للمدير فقط'::text; return; end if;
  if coalesce(trim(p_full_name),'')='' or coalesce(trim(p_email),'')='' or coalesce(trim(p_username),'')='' then return query select false,null::bigint,null::text,'الاسم والبريد واسم المستخدم مطلوبة'::text; return; end if;
  if not (p_role = any(v_allowed)) then return query select false,null::bigint,null::text,'دور غير صالح'::text; return; end if;
  if exists(select 1 from public.users where lower(email)=lower(p_email)) then return query select false,null::bigint,null::text,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  if exists(select 1 from public.users where lower(username)=lower(p_username)) then return query select false,null::bigint,null::text,'اسم المستخدم مستخدم مسبقاً'::text; return; end if;
  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  v_id := (select coalesce(max(id),0)+1 from public.users);
  insert into public.users(id,username,email,password,full_name,phone,role,department,position,employee_number,supervisor_id,is_active,must_change_password,hire_date,notes,created_at,updated_at)
  values (v_id,p_username,p_email,extensions.crypt(v_temp, extensions.gen_salt('bf',10)),p_full_name,p_phone,p_role,p_department,p_position,p_employee_number,p_supervisor_id,true,true,p_hire_date,p_notes,now(),now());
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,'create_user','user',v_id,'إنشاء مستخدم: '||p_full_name||' ('||p_role||') — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true,v_id,v_temp,'تم إنشاء المستخدم'::text;
end; $function$;

-- (5) request_password_reset — مؤقتة مجزّأة (تُعرض مرّة)
create or replace function public.request_password_reset(p_email text)
returns table(ok boolean, temp_password text, user_email text, user_name text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_user public.users; v_temp text; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; v_normalized text; i int;
begin
  v_normalized := lower(trim(coalesce(p_email,'')));
  if v_normalized = '' then return query select false,null::text,null::text,null::text,'البريد مطلوب'::text; return; end if;
  select * into v_user from public.users where lower(email)=v_normalized and is_active=true limit 1;
  if v_user.id is null then return query select false,null::text,null::text,null::text,'لا يوجد حساب نشط بهذا البريد'::text; return; end if;
  v_temp := '';
  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  update public.users set password = extensions.crypt(v_temp, extensions.gen_salt('bf',10)), must_change_password=true, password_reset_at=now(), updated_at=now() where id=v_user.id;
  return query select true, v_temp, v_user.email::text, v_user.full_name::text, 'تم توليد كلمة مرور مؤقتة'::text;
end;
$function$;

-- (6) admin_reset_password — مؤقتة مجزّأة (تُعرض مرّة)
create or replace function public.admin_reset_password(p_user_id bigint, p_session_token text default null)
returns table(ok boolean, temp_password text, user_email text, user_name text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_user public.users; v_temp text := ''; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; i int; v_sess record; v_actor text; v_ip text;
begin
  if p_user_id is null then return query select false,null::text,null::text,null::text,'معرّف المستخدم مطلوب'::text; return; end if;
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::text,null::text,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role <> 'admin' then return query select false,null::text,null::text,null::text,'هذه العملية للمدير فقط'::text; return; end if;
  begin v_ip := (current_setting('request.headers', true)::json ->> 'x-forwarded-for'); exception when others then v_ip := null; end;
  select * into v_user from public.users where id=p_user_id;
  if v_user.id is null then return query select false,null::text,null::text,null::text,'المستخدم غير موجود'::text; return; end if;
  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  update public.users set password = extensions.crypt(v_temp, extensions.gen_salt('bf',10)), must_change_password=true, password_reset_at=now(), updated_at=now() where id=p_user_id;
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,ip_address,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,'admin_reset_password','user',p_user_id,'إعادة تعيين كلمة مرور المستخدم #'||p_user_id||' ('||coalesce(v_user.full_name::text,'-')||') — بواسطة '||coalesce(v_actor,'النظام'),v_ip,now());
  return query select true, v_temp, v_user.email::text, v_user.full_name::text, 'تم إعادة تعيين كلمة المرور'::text;
end; $function$;

-- (7) create_employee — كلمة بداية مجزّأة (تُعرض مرّة)
create or replace function public.create_employee(p_session_token text, p_full_name text, p_email text, p_employee_number text, p_position text default null, p_department text default null, p_phone text default null, p_supervisor_id bigint default null, p_supervisor_name text default null)
returns table(ok boolean, user_id bigint, temp_password text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_sess record; v_actor text; v_temp text := ''; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; i int; v_id bigint;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::bigint,null::text,'ليس لديك صلاحية لإضافة موظف'::text; return; end if;
  if coalesce(trim(p_full_name),'')='' or coalesce(trim(p_email),'')='' or coalesce(trim(p_employee_number),'')='' then return query select false,null::bigint,null::text,'الاسم والبريد والرقم الوظيفي مطلوبة'::text; return; end if;
  if exists(select 1 from public.users where lower(email)=lower(p_email)) then return query select false,null::bigint,null::text,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  if exists(select 1 from public.users where lower(username)=lower(p_employee_number) or employee_number=p_employee_number) then return query select false,null::bigint,null::text,'الرقم الوظيفي مستخدم مسبقاً'::text; return; end if;
  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  v_id := (select coalesce(max(id),0)+1 from public.users);
  insert into public.users(id,username,email,password,full_name,phone,role,department,position,employee_number,supervisor_id,supervisor_name,is_active,must_change_password,created_at,updated_at)
  values(v_id,p_employee_number,p_email,extensions.crypt(v_temp, extensions.gen_salt('bf',10)),p_full_name,p_phone,'employee',coalesce(p_department,'قسم الجودة'),p_position,p_employee_number,p_supervisor_id,coalesce(p_supervisor_name,'-'),true,true,now(),now());
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,'create_user','user',v_id,'إضافة موظف: '||p_full_name||' ('||p_employee_number||') — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true,v_id,v_temp,'تم إضافة الموظف'::text;
end; $function$;

-- (8) تجزئة جماعية لكلمات المرور النصّية الموجودة (آخر خطوة بعد تحديث المقارنة)
update public.users
   set password = extensions.crypt(password, extensions.gen_salt('bf',10))
 where password is not null and password <> '' and password not like '$2%';

commit;
