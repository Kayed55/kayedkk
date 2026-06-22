-- ============================================================================
-- المرحلة 2 (أمان) — العملية 2: admin_reset_password بمصادقة الجلسة (دور admin)
-- ============================================================================
-- - رمز مُرَّر صالح + دور admin → تنفيذ، التدقيق بهوية الجلسة + IP + target.
-- - رمز صالح + دور غير admin    → رفض.
-- - رمز غير صالح/منتهٍ          → رفض.
-- - بلا رمز                      → مسار انتقالي + ملاحظة "[بدون مصادقة جلسة]" في التدقيق.
-- ============================================================================

begin;

drop function if exists public.admin_reset_password(bigint);

create or replace function public.admin_reset_password(
  p_user_id       bigint,
  p_session_token text default null
) returns table(
  ok            boolean,
  temp_password text,
  user_email    text,
  user_name     text,
  message       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user       public.users;
  v_temp       text;
  v_chars      constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  i            int;
  v_sess       record;
  v_actor_id   bigint;
  v_actor_name text;
  v_actor_role text;
  v_authed     boolean := false;
  v_ip         text;
begin
  if p_user_id is null then
    return query select false, null::text, null::text, null::text, 'معرّف المستخدم مطلوب'::text; return;
  end if;

  -- IP العميل (best-effort عبر ترويسات PostgREST)
  begin
    v_ip := (current_setting('request.headers', true)::json ->> 'x-forwarded-for');
  exception when others then v_ip := null; end;

  -- المصادقة عبر الجلسة
  if p_session_token is not null then
    select * into v_sess from public.verify_session(p_session_token);
    if not coalesce(v_sess.is_valid, false) then
      return query select false, null::text, null::text, null::text, 'انتهت الجلسة أو الرمز غير صالح'::text; return;
    end if;
    if v_sess.role <> 'admin' then
      return query select false, null::text, null::text, null::text, 'هذه العملية للمدير فقط'::text; return;
    end if;
    v_actor_id := v_sess.user_id; v_actor_role := v_sess.role; v_authed := true;
    select full_name::text into v_actor_name from public.users where id = v_sess.user_id;
  else
    v_actor_id := null; v_actor_name := 'النظام'; v_actor_role := '-';
  end if;

  select * into v_user from public.users where id = p_user_id;
  if v_user.id is null then
    return query select false, null::text, null::text, null::text, 'المستخدم غير موجود'::text; return;
  end if;

  v_temp := '';
  for i in 1..10 loop
    v_temp := v_temp || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;

  update public.users
     set password = v_temp, must_change_password = true, password_reset_at = now(), updated_at = now()
   where id = p_user_id;

  insert into public.audit_logs(id, user_id, user_name, role, action, entity_type, entity_id, details, ip_address, "timestamp")
  values(
    (select coalesce(max(id),0)+1 from public.audit_logs),
    v_actor_id, coalesce(v_actor_name,'النظام'), coalesce(v_actor_role,'-'),
    'admin_reset_password', 'user', p_user_id,
    'إعادة تعيين كلمة مرور المستخدم #'||p_user_id||' ('||coalesce(v_user.full_name::text,'-')||') — بواسطة '||
      coalesce(v_actor_name,'النظام') || case when v_authed then '' else ' [بدون مصادقة جلسة]' end,
    v_ip, now()
  );

  return query select true, v_temp, v_user.email::text, v_user.full_name::text, 'تم إعادة تعيين كلمة المرور'::text;
end;
$$;

revoke all on function public.admin_reset_password(bigint, text) from public;
grant execute on function public.admin_reset_password(bigint, text) to anon, authenticated;

commit;
