-- ============================================================================
-- المرحلة 2-ب-3 — الإغلاق النهائي: سحب الكتابة المباشرة عن anon + إلزام الرمز
-- ============================================================================
-- 1) سحب INSERT/UPDATE من anon/authenticated على كل جداول public (يبقى SELECT).
--    كل الكتابات تمرّ عبر RPCs بـ SECURITY DEFINER (تعمل بصلاحيات المالك).
-- 2) إزالة المسارات الانتقالية: delete_evaluation_cascade و admin_reset_password
--    تتطلّبان الآن جلسة صالحة (لا كتابة بلا رمز).
-- للتراجع: grant insert, update on all tables in schema public to anon, authenticated;
-- ============================================================================

begin;

-- 1) سحب الكتابة المباشرة --------------------------------------------------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke insert, update on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 2أ) delete_evaluation_cascade — الرمز إلزامي (لا مسار انتقالي) -------------
create or replace function public.delete_evaluation_cascade(
  p_eval_id bigint, p_actor_id bigint default null, p_actor_name text default null,
  p_actor_role text default null, p_session_token text default null
) returns table(ok boolean, employee_name text, deleted_objections int, message text)
language plpgsql security definer set search_path = public
as $$
declare v_eval public.evaluations; v_emp_name text; v_objs int := 0; v_sess record; v_actor text;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  if p_eval_id is null then return query select false,null::text,0,'رقم التقييم مطلوب'::text; return; end if;
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::text,0,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::text,0,'ليس لديك صلاحية لحذف التقييمات'::text; return; end if;

  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then return query select false,null::text,0,'التقييم غير موجود'::text; return; end if;
  select full_name::text into v_emp_name from public.users where id = v_eval.employee_id;
  select full_name::text into v_actor from public.users where id = v_sess.user_id;

  delete from public.objections where evaluation_id = p_eval_id;
  get diagnostics v_objs = row_count;
  delete from public.evaluations where id = p_eval_id;

  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'delete_evaluation','evaluation',p_eval_id,
    'حذف نهائي للتقييم #'||p_eval_id||' للموظف '||coalesce(v_emp_name,'-')||' (مع '||v_objs||' اعتراض) — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, coalesce(v_emp_name,'-'), v_objs, 'تم الحذف نهائياً'::text;
end; $$;

-- 2ب) admin_reset_password — الرمز إلزامي (دور admin) ----------------------
create or replace function public.admin_reset_password(
  p_user_id bigint, p_session_token text default null
) returns table(ok boolean, temp_password text, user_email text, user_name text, message text)
language plpgsql security definer set search_path = public
as $$
declare v_user public.users; v_temp text := ''; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  i int; v_sess record; v_actor text; v_ip text;
begin
  if p_user_id is null then return query select false,null::text,null::text,null::text,'معرّف المستخدم مطلوب'::text; return; end if;
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::text,null::text,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role <> 'admin' then return query select false,null::text,null::text,null::text,'هذه العملية للمدير فقط'::text; return; end if;

  begin v_ip := (current_setting('request.headers', true)::json ->> 'x-forwarded-for'); exception when others then v_ip := null; end;
  select * into v_user from public.users where id = p_user_id;
  if v_user.id is null then return query select false,null::text,null::text,null::text,'المستخدم غير موجود'::text; return; end if;

  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  update public.users set password=v_temp, must_change_password=true, password_reset_at=now(), updated_at=now() where id=p_user_id;

  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,ip_address,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'admin_reset_password','user',p_user_id,'إعادة تعيين كلمة مرور المستخدم #'||p_user_id||' ('||coalesce(v_user.full_name::text,'-')||') — بواسطة '||coalesce(v_actor,'النظام'),v_ip,now());

  return query select true, v_temp, v_user.email::text, v_user.full_name::text, 'تم إعادة تعيين كلمة المرور'::text;
end; $$;

commit;
